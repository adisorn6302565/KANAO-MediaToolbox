//! ข้อผิดพลาดของโปรแกรม — ทุกข้อความเป็นภาษาไทยที่ผู้ใช้อ่านเข้าใจได้
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("ไม่พบไฟล์หรือโฟลเดอร์: {0}")]
    NotFound(String),
    #[error("อ่านหรือเขียนไฟล์ไม่สำเร็จ: {0}")]
    Io(#[from] std::io::Error),
    #[error("ฐานข้อมูลมีปัญหา: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("ข้อมูลไม่ถูกต้อง: {0}")]
    Json(#[from] serde_json::Error),
    #[error("ไม่พบโปรแกรม {0} — กรุณาตั้งพาธในหน้า ตั้งค่า หรือติดตั้งโปรแกรมใหม่")]
    MissingTool(String),
    #[error("รหัสผ่านไม่ถูกต้อง หรือไฟล์เสียหาย")]
    BadPassword,
    #[error("ไฟล์ PDF มีปัญหา: {0}")]
    Pdf(String),
    #[error("{0}")]
    Msg(String),
}

impl From<lopdf::Error> for AppError {
    fn from(e: lopdf::Error) -> Self {
        AppError::Pdf(e.to_string())
    }
}

impl From<zip::result::ZipError> for AppError {
    fn from(e: zip::result::ZipError) -> Self {
        AppError::Msg(format!("จัดการไฟล์ ZIP ไม่สำเร็จ: {e}"))
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Msg(format!("ระบบภายในผิดพลาด: {e}"))
    }
}

// ส่ง error ไปหน้าบ้านเป็นข้อความธรรมดา
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

pub fn msg<T>(s: impl Into<String>) -> AppResult<T> {
    Err(AppError::Msg(s.into()))
}
