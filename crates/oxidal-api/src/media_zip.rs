//! Write-only, stored ZIP archives for known-size WAV files.
//! Format: PKWARE APPNOTE 6.3.10, sections 4.3 and 4.5.3.

use std::io::{self, Seek, SeekFrom, Write};

const LIMIT: u64 = u32::MAX as u64;
const DOS_DATE: u16 = 33; // 1980-01-01

pub(crate) struct Zip<W> {
    file: W,
    entries: Vec<Entry>,
}

struct Entry {
    name: String,
    offset: u64,
    size: u64,
    crc: u32,
}

fn u16le(out: &mut impl Write, value: u16) -> io::Result<()> {
    out.write_all(&value.to_le_bytes())
}
fn u32le(out: &mut impl Write, value: u32) -> io::Result<()> {
    out.write_all(&value.to_le_bytes())
}
fn u64le(out: &mut impl Write, value: u64) -> io::Result<()> {
    out.write_all(&value.to_le_bytes())
}

impl Entry {
    fn fields(&self, file: &mut impl Write, central: bool) -> io::Result<()> {
        let large = self.size >= LIMIT;
        let far = central && self.offset >= LIMIT;
        let extra_size = 16 * u16::from(large) + 8 * u16::from(far);
        u16le(file, if extra_size > 0 { 45 } else { 10 })?;
        for value in [0, 0, 0, DOS_DATE] {
            u16le(file, value)?; // flags, STORED, time, date
        }
        u32le(file, self.crc)?;
        u32le(file, self.size.min(LIMIT) as u32)?;
        u32le(file, self.size.min(LIMIT) as u32)?;
        u16le(file, self.name.len() as u16)?;
        u16le(file, if extra_size > 0 { extra_size + 4 } else { 0 })?;
        if central {
            for value in [0, 0, 0] {
                u16le(file, value)?;
            }
            u32le(file, 0)?;
            u32le(file, self.offset.min(LIMIT) as u32)?;
        }
        file.write_all(self.name.as_bytes())?;
        if extra_size > 0 {
            u16le(file, 1)?;
            u16le(file, extra_size)?;
        }
        if large {
            u64le(file, self.size)?;
            u64le(file, self.size)?;
        }
        if far {
            u64le(file, self.offset)?;
        }
        Ok(())
    }
}

struct Payload<'a, W> {
    file: &'a mut W,
    crc: crc32fast::Hasher,
}

impl<W: Write> Write for Payload<'_, W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let written = self.file.write(bytes)?;
        self.crc.update(&bytes[..written]);
        Ok(written)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

impl<W: Write + Seek> Zip<W> {
    pub(crate) fn new(file: W) -> Self {
        Self {
            file,
            entries: Vec::new(),
        }
    }

    /// Write a single named file from start to finish, then fix its local CRC.
    pub(crate) fn add(
        &mut self,
        name: String,
        size: u64,
        fill: impl FnOnce(&mut dyn Write) -> io::Result<()>,
    ) -> io::Result<()> {
        let offset = self.file.stream_position()?;
        let mut entry = Entry {
            name,
            offset,
            size,
            crc: 0,
        };
        u32le(&mut self.file, 0x0403_4b50)?;
        entry.fields(&mut self.file, false)?;
        let start = self.file.stream_position()?;
        let mut payload = Payload {
            file: &mut self.file,
            crc: crc32fast::Hasher::new(),
        };
        fill(&mut payload)?;
        entry.crc = payload.crc.finalize();
        let end = self.file.stream_position()?;
        if end.checked_sub(start) != Some(size) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "ZIP entry length changed",
            ));
        }
        self.file.seek(SeekFrom::Start(offset + 14))?;
        u32le(&mut self.file, entry.crc)?;
        self.file.seek(SeekFrom::Start(end))?;
        self.entries.push(entry);
        Ok(())
    }

    pub(crate) fn finish(mut self) -> io::Result<W> {
        let offset = self.file.stream_position()?;
        for entry in &self.entries {
            u32le(&mut self.file, 0x0201_4b50)?;
            u16le(&mut self.file, 45)?; // writer version
            entry.fields(&mut self.file, true)?;
        }
        let end = self.file.stream_position()?;
        let size = end - offset;
        let count = self.entries.len() as u64;
        if offset >= LIMIT || size >= LIMIT || count >= u64::from(u16::MAX) {
            u32le(&mut self.file, 0x0606_4b50)?;
            u64le(&mut self.file, 44)?;
            u16le(&mut self.file, 45)?;
            u16le(&mut self.file, 45)?;
            u32le(&mut self.file, 0)?;
            u32le(&mut self.file, 0)?;
            for value in [count, count, size, offset] {
                u64le(&mut self.file, value)?;
            }
            u32le(&mut self.file, 0x0706_4b50)?;
            u32le(&mut self.file, 0)?;
            u64le(&mut self.file, end)?;
            u32le(&mut self.file, 1)?;
        }
        u32le(&mut self.file, 0x0605_4b50)?;
        u16le(&mut self.file, 0)?;
        u16le(&mut self.file, 0)?;
        let count = count.min(u64::from(u16::MAX)) as u16;
        u16le(&mut self.file, count)?;
        u16le(&mut self.file, count)?;
        u32le(&mut self.file, size.min(LIMIT) as u32)?;
        u32le(&mut self.file, offset.min(LIMIT) as u32)?;
        u16le(&mut self.file, 0)?;
        self.file.flush()?;
        Ok(self.file)
    }
}
