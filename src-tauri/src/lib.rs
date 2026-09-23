//! มีเดียทูลบ็อกซ์ — จุดเริ่มต้นของ backend (Tauri 2)
mod commands;
mod core;
mod error;
mod state;

use crate::core::jobs::{JobSpec, NewJob};
use state::AppState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// โหมด CLI: MediaToolbox.exe --download <URL> [--audio]  |  --convert <ไฟล์เข้า> <ไฟล์ออก>
fn handle_cli(app: &AppHandle, args: &[String]) {
    let state = app.state::<AppState>();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--download" | "-d" if i + 1 < args.len() => {
                let audio = args.iter().any(|a| a == "--audio");
                let opts = commands::jobs::DownloadOptions {
                    urls: vec![args[i + 1].clone()],
                    mode: if audio { "audio".into() } else { "video".into() },
                    format: if audio { "mp3".into() } else { "mp4".into() },
                    ..Default::default()
                };
                let s = state.settings.lock().unwrap().clone();
                let a = commands::jobs::build_download_args(&opts, &s);
                state.jobs.add(
                    app,
                    NewJob {
                        kind: "download".into(),
                        title: format!("[CLI] {}", args[i + 1]),
                        input: args[i + 1].clone(),
                        output: s.download_dir.clone(),
                        start_at: None,
                        spec: JobSpec::Download { url: args[i + 1].clone(), args: a },
                    },
                );
                i += 2;
            }
            "--convert" | "-c" if i + 2 < args.len() => {
                let (inp, out) = (args[i + 1].clone(), args[i + 2].clone());
                state.jobs.add(
                    app,
                    NewJob {
                        kind: "convert".into(),
                        title: format!("[CLI] แปลง {inp}"),
                        input: inp.clone(),
                        output: out.clone(),
                        start_at: None,
                        spec: JobSpec::Ffmpeg { passes: vec![vec!["-y".into(), "-i".into(), inp, out]], duration: 0.0, graceful_stop: false },
                    },
                );
                i += 3;
            }
            other => {
                // ลากไฟล์มาวางบนไอคอนโปรแกรม → เปิดในเครื่องเล่น
                if std::path::Path::new(other).is_file() {
                    let _ = app.emit("open-file", other.to_string());
                }
                i += 1;
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // เปิดโปรแกรมซ้ำ → โฟกัสหน้าต่างเดิม และส่งต่ออาร์กิวเมนต์
            show_main(app);
            let args: Vec<String> = argv.into_iter().skip(1).collect();
            handle_cli(app, &args);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let resource_dir = app.path().resource_dir().ok();
            let st = AppState::new(data_dir, resource_dir).map_err(|e| e.to_string())?;
            st.log("info", "app", "เปิดโปรแกรม");
            app.manage(st);

            // ถาดระบบ
            let open = MenuItem::with_id(app, "open", "เปิดมีเดียทูลบ็อกซ์", true, None::<&str>)?;
            let stop_rec = MenuItem::with_id(app, "stop_rec", "หยุดอัดหน้าจอ", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "ออกจากโปรแกรม", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &stop_rec, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("มีเดียทูลบ็อกซ์")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show_main(app),
                    "stop_rec" => {
                        let a = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Ok(p) = commands::media::stop_and_save(a.clone()).await {
                                use tauri_plugin_notification::NotificationExt;
                                let _ = a.notification().builder().title("บันทึกคลิปที่อัดแล้ว").body(p).show();
                            }
                        });
                    }
                    "quit" => {
                        core::recorder::stop_if_recording(app.state::<AppState>().tool("ffmpeg").ok());
                        app.exit(0)
                    }
                    _ => {}
                })
                .on_tray_icon_event(|t, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = e {
                        show_main(t.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            core::jobs::start_scheduler(app.handle().clone());

            let args: Vec<String> = std::env::args().skip(1).collect();
            if args.iter().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            handle_cli(app.handle(), &args);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // ย่อลงถาดระบบแทนการปิด — งานโหลดทำต่อเบื้องหลัง
                let state = window.state::<AppState>();
                let to_tray = state.settings.lock().unwrap().minimize_to_tray;
                let busy = state.jobs.list().iter().any(|j| j.status == "running" || j.status == "queued");
                if to_tray || busy {
                    api.prevent_close();
                    let _ = window.hide();
                    if busy && !to_tray {
                        use tauri_plugin_notification::NotificationExt;
                        let _ = window
                            .app_handle()
                            .notification()
                            .builder()
                            .title("ยังทำงานอยู่เบื้องหลัง")
                            .body("มีงานในคิว — โปรแกรมจะทำต่อในถาดระบบ คลิกไอคอนเพื่อเปิด")
                            .show();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::reset_settings,
            commands::settings::backup_settings,
            commands::settings::restore_settings,
            commands::settings::tool_status,
            commands::settings::app_info,
            commands::settings::kv_get,
            commands::settings::kv_set,
            commands::jobs::list_jobs,
            commands::jobs::job_action,
            commands::jobs::add_job,
            commands::jobs::start_download,
            commands::jobs::fetch_info,
            commands::jobs::update_ytdlp,
            commands::jobs::ffmpeg_job,
            commands::jobs::ffmpeg_exec,
            commands::jobs::list_devices,
            commands::jobs::probe_media,
            commands::jobs::make_thumbnail,
            commands::files::scan_files,
            commands::files::list_dir,
            commands::files::folder_sizes,
            commands::files::find_duplicates,
            commands::files::find_large,
            commands::files::find_empty_dirs,
            commands::files::remove_empty_dirs,
            commands::files::move_files,
            commands::files::delete_files,
            commands::files::rename_files,
            commands::files::organize_files,
            commands::files::hash_file,
            commands::files::zip_files,
            commands::files::extract_archive,
            commands::files::create_tar,
            commands::files::split_file,
            commands::files::join_files,
            commands::files::read_text_file,
            commands::files::write_text_file,
            commands::files::write_base64_file,
            commands::files::path_info,
            commands::files::temp_dir,
            commands::system::system_stats,
            commands::system::gpu_info,
            commands::system::list_history,
            commands::system::delete_history,
            commands::system::clear_history,
            commands::system::list_logs,
            commands::system::add_log,
            commands::system::clear_logs,
            commands::system::pdf_tool,
            commands::system::encrypt_file,
            commands::system::shred_files,
            commands::system::set_pin,
            commands::system::verify_pin,
            commands::system::has_pin,
            commands::system::start_server,
            commands::system::stop_server,
            commands::system::server_status,
            commands::system::ftp_control,
            commands::system::notify,
            commands::system::panic_hide,
            commands::dev::http_request,
            commands::dev::send_webhook,
            commands::dev::run_rclone,
            commands::dev::install_rclone,
            commands::dev::rclone_config,
            commands::media::rec_devices,
            commands::media::rec_start,
            commands::media::rec_stop,
            commands::media::rec_status,
            commands::media::clean_scan,
            commands::media::clean_run,
            commands::media::startup_list,
            commands::media::startup_set,
            commands::media::is_admin,
            commands::media::relaunch_admin,
            commands::media::play_stream_url,
            commands::media::voice_listen,
            commands::media::list_windows,
            commands::media::dlna_discover,
            commands::media::dlna_cast,
            commands::media::dlna_control,
        ])
        .run(tauri::generate_context!())
        .expect("เปิดโปรแกรมไม่สำเร็จ");
}
