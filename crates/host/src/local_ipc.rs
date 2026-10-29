use agai_protocol::*;
use std::io::{Read, Write};
pub const MAX_FRAME: usize = 16 * 1024 * 1024;
pub fn read_frame(r: &mut impl Read) -> Result<Vec<u8>> {
    let mut length = [0; 4];
    r.read_exact(&mut length)
        .map_err(|_| AppError::new("INVALID_FRAME"))?;
    let n = u32::from_be_bytes(length) as usize;
    if n > MAX_FRAME {
        return Err(AppError::new("FRAME_TOO_LARGE"));
    }
    let mut b = vec![0; n];
    r.read_exact(&mut b)
        .map_err(|_| AppError::new("INVALID_FRAME"))?;
    Ok(b)
}
pub fn write_frame(w: &mut impl Write, b: &[u8]) -> Result<()> {
    if b.len() > MAX_FRAME {
        return Err(AppError::new("FRAME_TOO_LARGE"));
    }
    w.write_all(&(b.len() as u32).to_be_bytes())
        .and_then(|_| w.write_all(b))
        .map_err(|_| AppError::new("IO_ERROR"))
}
