import { deflateSync } from 'node:zlib';
// Encode only validated, already blurred RGB samples. No original image enters this endpoint.
export function previewPng(preview){
 const legacy=typeof preview==='string';const width=legacy?8:preview.width,height=legacy?8:preview.height;
 const rgb=Buffer.from(legacy?preview:preview.pixels,'base64');const rows=Buffer.alloc(height*(width*3+1));
 for(let y=0;y<height;y++)rgb.copy(rows,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
 const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};
 const chunk=(type,bytes)=>{const label=Buffer.from(type),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(bytes.length);checksum.writeUInt32BE(crc(Buffer.concat([label,bytes])));return Buffer.concat([size,label,bytes,checksum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
