//! เครื่องมือ PDF: บีบอัด, รวม, แยก, หมุน, ลบหน้า, แทรกหน้าว่าง, ลบ metadata
use crate::error::{AppError, AppResult};
use lopdf::{dictionary, Document, Object, ObjectId};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub fn page_count(path: &Path) -> AppResult<u32> {
    Ok(Document::load(path)?.get_pages().len() as u32)
}

/// บีบอัดแบบไม่เสียคุณภาพ: ลบ object ซ้ำ/ไม่ใช้, บีบ stream, ลบ metadata
pub fn compress_lossless(src: &Path, dst: &Path, strip_meta: bool) -> AppResult<()> {
    let mut doc = Document::load(src)?;
    if strip_meta {
        doc.trailer.remove(b"Info");
        if let Ok(cat) = doc.catalog_mut() {
            cat.remove(b"Metadata");
        }
    }
    doc.delete_zero_length_streams();
    doc.prune_objects();
    doc.renumber_objects();
    doc.compress();
    doc.save(dst)?;
    Ok(())
}

/// บีบอัดรูปภาพใน PDF เอง (ไม่ต้องมี Ghostscript): ย่อรูปที่ใหญ่เกิน max_side แล้วเข้ารหัส JPEG ใหม่ที่คุณภาพ quality
/// คืนจำนวนรูปที่ถูกแทนที่ — ใช้เฉพาะรูป RGB/Gray 8 บิตที่ปลอดภัย (ข้าม CMYK, Indexed, ImageMask, Decode array)
pub fn compress_images(src: &Path, dst: &Path, quality: u8, max_side: u32, strip_meta: bool) -> AppResult<usize> {
    use image::codecs::jpeg::JpegEncoder;
    use image::{DynamicImage, GrayImage, RgbImage};
    let mut doc = Document::load(src)?;
    let mut replaced = 0;
    for obj in doc.objects.values_mut() {
        let Object::Stream(stream) = obj else { continue };
        let d = &stream.dict;
        if d.get(b"Subtype").and_then(Object::as_name).ok() != Some(b"Image".as_slice()) {
            continue;
        }
        if d.get(b"ImageMask").and_then(Object::as_bool).unwrap_or(false) || d.has(b"Decode") {
            continue;
        }
        let w = d.get(b"Width").and_then(Object::as_i64).unwrap_or(0) as u32;
        let h = d.get(b"Height").and_then(Object::as_i64).unwrap_or(0) as u32;
        if w < 64 || h < 64 {
            continue;
        }
        let cs = d.get(b"ColorSpace").and_then(Object::as_name).ok().map(|n| n.to_vec());
        let filters: Vec<Vec<u8>> = stream.filters().map(|f| f.iter().map(|x| x.to_vec()).collect()).unwrap_or_default();
        let old_len = stream.content.len();
        // ถอดรหัสรูปเป็นพิกเซล
        let img: Option<DynamicImage> = if filters == [b"DCTDecode".to_vec()] {
            image::load_from_memory_with_format(&stream.content, image::ImageFormat::Jpeg).ok().filter(|i| {
                // JPEG CMYK จะถูกแปลงสีตอนถอดรหัส — ข้ามเพื่อไม่ให้สีเพี้ยน
                !matches!(cs.as_deref(), Some(b"DeviceCMYK"))
                    && matches!(i.color(), image::ColorType::Rgb8 | image::ColorType::L8)
            })
        } else if filters.iter().all(|f| f == b"FlateDecode") && d.get(b"BitsPerComponent").and_then(Object::as_i64).unwrap_or(0) == 8 {
            let raw = stream.get_plain_content_with_limit(400 * 1024 * 1024).ok();
            match (cs.as_deref(), raw) {
                (Some(b"DeviceRGB"), Some(r)) if r.len() >= (w * h * 3) as usize => RgbImage::from_raw(w, h, r[..(w * h * 3) as usize].to_vec()).map(DynamicImage::ImageRgb8),
                (Some(b"DeviceGray"), Some(r)) if r.len() >= (w * h) as usize => GrayImage::from_raw(w, h, r[..(w * h) as usize].to_vec()).map(DynamicImage::ImageLuma8),
                _ => None,
            }
        } else {
            None
        };
        let Some(mut img) = img else { continue };
        if w.max(h) > max_side {
            img = img.resize(max_side, max_side, image::imageops::FilterType::Triangle);
        }
        let gray = matches!(img, DynamicImage::ImageLuma8(_));
        let mut buf = Vec::new();
        let enc = JpegEncoder::new_with_quality(&mut buf, quality.clamp(10, 95));
        let ok = if gray { img.to_luma8().write_with_encoder(enc) } else { img.to_rgb8().write_with_encoder(enc) };
        if ok.is_err() || buf.len() >= old_len {
            continue; // ไม่เล็กลง — เก็บของเดิม
        }
        let (nw, nh) = (img.width(), img.height());
        stream.dict.set("Width", nw as i64);
        stream.dict.set("Height", nh as i64);
        stream.dict.set("ColorSpace", if gray { "DeviceGray" } else { "DeviceRGB" });
        stream.dict.set("BitsPerComponent", 8);
        stream.dict.remove(b"DecodeParms");
        stream.dict.set("Filter", "DCTDecode");
        stream.set_content(buf);
        stream.allows_compression = false;
        replaced += 1;
    }
    let tmp = dst.with_extension("tmp.pdf");
    doc.save(&tmp)?;
    compress_lossless(&tmp, dst, strip_meta)?;
    let _ = std::fs::remove_file(&tmp);
    Ok(replaced)
}

/// ใส่รหัสผ่านเปิดไฟล์ PDF (AES-256) — ไม่ต้องใช้ qpdf
pub fn encrypt(src: &Path, dst: &Path, user_pw: &str, owner_pw: &str) -> AppResult<()> {
    use lopdf::encryption::crypt_filters::{Aes256CryptFilter, CryptFilter};
    use lopdf::{EncryptionState, EncryptionVersion, Permissions};
    use std::sync::Arc;
    if user_pw.is_empty() {
        return Err(AppError::Msg("ยังไม่ได้ตั้งรหัสผ่าน".into()));
    }
    let mut doc = Document::load(src)?;
    if doc.is_encrypted() {
        return Err(AppError::Msg("ไฟล์นี้มีรหัสผ่านอยู่แล้ว".into()));
    }
    doc.version = "1.7".into();
    let key: [u8; 32] = rand::random();
    let filter: Arc<dyn CryptFilter> = Arc::new(Aes256CryptFilter);
    let state = EncryptionState::try_from(EncryptionVersion::V5 {
        encrypt_metadata: true,
        crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), filter)]),
        file_encryption_key: &key,
        stream_filter: b"StdCF".to_vec(),
        string_filter: b"StdCF".to_vec(),
        owner_password: if owner_pw.is_empty() { user_pw } else { owner_pw },
        user_password: user_pw,
        permissions: Permissions::all(),
    })?;
    doc.compress();
    doc.encrypt(&state)?;
    doc.save(dst)?;
    Ok(())
}

/// คัดลอกค่าที่หน้าสืบทอดจากโหนด Pages แม่ (Resources, MediaBox, CropBox, Rotate) มาใส่ในหน้าเอง
/// — จำเป็นก่อนย้ายหน้าไปอยู่ใต้ Pages ตัวใหม่ ไม่งั้นหน้าจะว่างหรือผิดขนาด
fn materialize_inherited(doc: &mut Document, page_id: ObjectId) {
    const KEYS: [&[u8]; 4] = [b"Resources", b"MediaBox", b"CropBox", b"Rotate"];
    let Ok(page) = doc.get_object(page_id).and_then(Object::as_dict) else { return };
    let mut missing: Vec<&[u8]> = KEYS.iter().copied().filter(|k| !page.has(k)).collect();
    let mut parent = page.get(b"Parent").and_then(Object::as_reference).ok();
    let mut found: Vec<(&[u8], Object)> = Vec::new();
    let mut depth = 0;
    while let Some(pid) = parent {
        depth += 1;
        if missing.is_empty() || depth > 64 {
            break;
        }
        let Ok(node) = doc.get_object(pid).and_then(Object::as_dict) else { break };
        missing.retain(|k| match node.get(k) {
            Ok(v) => {
                found.push((*k, v.clone()));
                false
            }
            Err(_) => true,
        });
        parent = node.get(b"Parent").and_then(Object::as_reference).ok();
    }
    if let Ok(page) = doc.get_object_mut(page_id).and_then(Object::as_dict_mut) {
        for (k, v) in found {
            page.set(k.to_vec(), v);
        }
    }
}

fn parse_pages(spec: &str, max: u32) -> Vec<u32> {
    // รูปแบบ "1,3,5-7"
    let mut out = Vec::new();
    for part in spec.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        if let Some((a, b)) = part.split_once('-') {
            let a: u32 = a.trim().parse().unwrap_or(1);
            let b: u32 = b.trim().parse().unwrap_or(max);
            for i in a.min(b)..=b.max(a) {
                if i >= 1 && i <= max {
                    out.push(i);
                }
            }
        } else if let Ok(i) = part.parse::<u32>() {
            if i >= 1 && i <= max {
                out.push(i);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

pub fn delete_pages(src: &Path, dst: &Path, spec: &str) -> AppResult<()> {
    let mut doc = Document::load(src)?;
    let max = doc.get_pages().len() as u32;
    let pages = parse_pages(spec, max);
    if pages.len() as u32 >= max {
        return Err(AppError::Msg("ลบทุกหน้าไม่ได้ ต้องเหลืออย่างน้อย 1 หน้า".into()));
    }
    doc.delete_pages(&pages);
    doc.prune_objects();
    doc.save(dst)?;
    Ok(())
}

pub fn rotate_pages(src: &Path, dst: &Path, spec: &str, degrees: i64) -> AppResult<()> {
    let mut doc = Document::load(src)?;
    let pages = doc.get_pages();
    let max = pages.len() as u32;
    let targets = if spec.trim().is_empty() {
        (1..=max).collect()
    } else {
        parse_pages(spec, max)
    };
    for n in targets {
        if let Some(id) = pages.get(&n) {
            if let Ok(dict) = doc.get_object_mut(*id).and_then(Object::as_dict_mut) {
                let cur = dict.get(b"Rotate").and_then(Object::as_i64).unwrap_or(0);
                dict.set("Rotate", ((cur + degrees) % 360 + 360) % 360);
            }
        }
    }
    doc.save(dst)?;
    Ok(())
}

/// แยกทุกหน้าเป็นไฟล์ละ 1 หน้า หรือแยกตามช่วง
pub fn split(src: &Path, out_dir: &Path, spec: &str) -> AppResult<Vec<PathBuf>> {
    let base = Document::load(src)?;
    let max = base.get_pages().len() as u32;
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    std::fs::create_dir_all(out_dir)?;
    let groups: Vec<Vec<u32>> = if spec.trim().is_empty() {
        (1..=max).map(|i| vec![i]).collect()
    } else {
        spec.split(';').map(|g| parse_pages(g, max)).filter(|g| !g.is_empty()).collect()
    };
    let mut out = Vec::new();
    for (idx, keep) in groups.iter().enumerate() {
        let mut doc = base.clone();
        let remove: Vec<u32> = (1..=max).filter(|p| !keep.contains(p)).collect();
        doc.delete_pages(&remove);
        doc.prune_objects();
        let name = if keep.len() == 1 {
            format!("{stem}_หน้า{}.pdf", keep[0])
        } else {
            format!("{stem}_ส่วน{}.pdf", idx + 1)
        };
        let p = out_dir.join(name);
        doc.save(&p)?;
        out.push(p);
    }
    Ok(out)
}

/// แทรกหน้าว่าง (ขนาดเท่าหน้าแรก) หลังหน้าที่กำหนด (0 = หน้าแรกสุด)
pub fn insert_blank(src: &Path, dst: &Path, after: u32) -> AppResult<()> {
    let mut doc = Document::load(src)?;
    let pages = doc.get_pages();
    for id in pages.values() {
        materialize_inherited(&mut doc, *id);
    }
    let first = *pages.get(&1).ok_or_else(|| AppError::Pdf("ไม่มีหน้าในไฟล์".into()))?;
    let media_box = doc
        .get_object(first)
        .and_then(Object::as_dict)
        .and_then(|d| d.get(b"MediaBox").cloned())
        .unwrap_or_else(|_| vec![0.into(), 0.into(), 595.into(), 842.into()].into());
    let pages_id = doc
        .catalog()
        .and_then(|c| c.get(b"Pages"))
        .and_then(Object::as_reference)?;
    let content_id = doc.add_object(lopdf::Stream::new(dictionary! {}, Vec::new()));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => media_box,
        "Contents" => content_id,
        "Resources" => dictionary! {},
    });
    // ต่อรายการหน้าใหม่ทั้งหมดไว้ใต้ Pages ราก (ทำให้โครงสร้างแบน)
    let mut order: Vec<ObjectId> = pages.values().copied().collect();
    let pos = (after as usize).min(order.len());
    order.insert(pos, page_id);
    for id in &order {
        if let Ok(d) = doc.get_object_mut(*id).and_then(Object::as_dict_mut) {
            d.set("Parent", pages_id);
        }
    }
    let root = doc.get_object_mut(pages_id).and_then(Object::as_dict_mut)?;
    root.set("Kids", order.iter().map(|i| Object::Reference(*i)).collect::<Vec<_>>());
    root.set("Count", order.len() as i64);
    doc.save(dst)?;
    Ok(())
}

/// รวมหลาย PDF เป็นไฟล์เดียว (ตามตัวอย่างของ lopdf)
pub fn merge(inputs: &[PathBuf], dst: &Path) -> AppResult<()> {
    if inputs.len() < 2 {
        return Err(AppError::Msg("ต้องเลือก PDF อย่างน้อย 2 ไฟล์".into()));
    }
    let mut max_id = 1;
    // เรียงตามลำดับหน้าจริงของแต่ละไฟล์ (ไม่ใช่ตามเลข object ซึ่งอาจไม่เรียง)
    let mut pages: Vec<(ObjectId, Object)> = Vec::new();
    let mut objects: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut document = Document::with_version("1.5");

    for p in inputs {
        let mut doc = Document::load(p)?;
        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;
        for (_, id) in doc.get_pages() {
            materialize_inherited(&mut doc, id);
            if let Ok(o) = doc.get_object(id) {
                pages.push((id, o.to_owned()));
            }
        }
        objects.extend(doc.objects);
    }

    let mut catalog: Option<(ObjectId, Object)> = None;
    let mut pages_obj: Option<(ObjectId, Object)> = None;
    for (id, obj) in objects.iter() {
        match obj.type_name().unwrap_or(b"") {
            b"Catalog" => {
                if catalog.is_none() {
                    catalog = Some((*id, obj.clone()));
                }
            }
            b"Pages" => {
                if let Ok(dict) = obj.as_dict() {
                    let mut dict = dict.clone();
                    if let Some((_, ref old)) = pages_obj {
                        if let Ok(old) = old.as_dict() {
                            dict.extend(old);
                        }
                    }
                    pages_obj = Some((pages_obj.as_ref().map(|(i, _)| *i).unwrap_or(*id), Object::Dictionary(dict)));
                }
            }
            b"Page" | b"Outlines" | b"Outline" => {}
            _ => {
                document.objects.insert(*id, obj.clone());
            }
        }
    }
    let (pages_id, pages_root) = pages_obj.ok_or_else(|| AppError::Pdf("ไม่พบโครงสร้างหน้า".into()))?;
    for (id, obj) in pages.iter() {
        if let Ok(dict) = obj.as_dict() {
            let mut dict = dict.clone();
            dict.set("Parent", pages_id);
            document.objects.insert(*id, Object::Dictionary(dict));
        }
    }
    let (catalog_id, catalog_obj) = catalog.ok_or_else(|| AppError::Pdf("ไม่พบ Catalog".into()))?;
    if let Ok(dict) = pages_root.as_dict() {
        let mut dict = dict.clone();
        dict.remove(b"Parent"); // มาจากโหนด Pages ย่อยที่ถูกรวม — รากต้องไม่มี Parent
        dict.set("Count", pages.len() as u32);
        dict.set("Kids", pages.iter().map(|(id, _)| Object::Reference(*id)).collect::<Vec<_>>());
        document.objects.insert(pages_id, Object::Dictionary(dict));
    }
    if let Ok(dict) = catalog_obj.as_dict() {
        let mut dict = dict.clone();
        dict.set("Pages", pages_id);
        dict.remove(b"Outlines");
        document.objects.insert(catalog_id, Object::Dictionary(dict));
    }
    document.trailer.set("Root", catalog_id);
    document.max_id = document.objects.len() as u32;
    document.renumber_objects();
    document.compress();
    document.save(dst)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::content::{Content, Operation};

    fn make_pdf(path: &Path, n: usize) {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let mut kids = vec![];
        for i in 0..n {
            let content = Content {
                operations: vec![Operation::new("BT", vec![]), Operation::new("Tj", vec![Object::string_literal(format!("P{i}"))]), Operation::new("ET", vec![])],
            };
            let cid = doc.add_object(lopdf::Stream::new(dictionary! {}, content.encode().unwrap()));
            let pid = doc.add_object(dictionary! {"Type"=>"Page","Parent"=>pages_id,"Contents"=>cid,"MediaBox"=>vec![0.into(),0.into(),595.into(),842.into()]});
            kids.push(Object::Reference(pid));
        }
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! {"Type"=>"Pages","Kids"=>kids,"Count"=>n as i64}));
        let cat = doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages_id});
        doc.trailer.set("Root", cat);
        doc.save(path).unwrap();
    }

    #[test]
    fn pdf_ops() {
        let d = std::env::temp_dir().join(format!("mtb-pdf-{}", rand::random::<u32>()));
        std::fs::create_dir_all(&d).unwrap();
        let a = d.join("เอกสาร.pdf");
        let b = d.join("b.pdf");
        make_pdf(&a, 3);
        make_pdf(&b, 2);
        let m = d.join("m.pdf");
        merge(&[a.clone(), b.clone()], &m).unwrap();
        assert_eq!(page_count(&m).unwrap(), 5);
        delete_pages(&m, &d.join("del.pdf"), "1,4-5").unwrap();
        assert_eq!(page_count(&d.join("del.pdf")).unwrap(), 2);
        rotate_pages(&a, &d.join("rot.pdf"), "", 90).unwrap();
        insert_blank(&a, &d.join("ins.pdf"), 1).unwrap();
        assert_eq!(page_count(&d.join("ins.pdf")).unwrap(), 4);
        let parts = split(&a, &d.join("split"), "").unwrap();
        assert_eq!(parts.len(), 3);
        assert_eq!(page_count(&parts[0]).unwrap(), 1);
        compress_lossless(&m, &d.join("c.pdf"), true).unwrap();
        assert_eq!(page_count(&d.join("c.pdf")).unwrap(), 5);
        assert_eq!(parse_pages("1, 3-4, 9", 5), vec![1, 3, 4]);
        // เข้ารหัสแล้วต้องเปิดด้วยรหัสได้
        encrypt(&a, &d.join("enc.pdf"), "ลับ1234", "").unwrap();
        assert!(Document::load_with_password(d.join("enc.pdf"), "ผิด").is_err());
        let e = Document::load_with_password(d.join("enc.pdf"), "ลับ1234").unwrap();
        assert_eq!(e.get_pages().len(), 3);
        // รูปใน PDF ถูกย่อ/บีบจริง
        let big = image::RgbImage::from_fn(1600, 1200, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8]));
        let mut doc = Document::load(&a).unwrap();
        let img = doc.add_object(lopdf::Stream::new(
            dictionary! {"Type"=>"XObject","Subtype"=>"Image","Width"=>1600,"Height"=>1200,"ColorSpace"=>"DeviceRGB","BitsPerComponent"=>8},
            big.into_raw(),
        ));
        let p1 = *doc.get_pages().get(&1).unwrap();
        doc.get_object_mut(p1).unwrap().as_dict_mut().unwrap().set("Resources", dictionary! {"XObject" => dictionary!{"Im0" => img}});
        doc.save(d.join("img.pdf")).unwrap();
        let n = compress_images(&d.join("img.pdf"), &d.join("img-c.pdf"), 60, 800, true).unwrap();
        assert_eq!(n, 1);
        assert!(std::fs::metadata(d.join("img-c.pdf")).unwrap().len() * 5 < std::fs::metadata(d.join("img.pdf")).unwrap().len());
        std::fs::remove_dir_all(d).unwrap();
    }
}
