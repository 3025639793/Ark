const {deflateSync}=require('node:zlib');
// Small, valid, opaque PNG fixtures for native image decoding and layout checks.
module.exports.fixturePng=(width,height,pixel=()=>[150,120,180,255])=>{
 const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};
 const chunk=(type,bytes)=>{const label=Buffer.from(type);const size=Buffer.alloc(4);size.writeUInt32BE(bytes.length);const checksum=Buffer.alloc(4);checksum.writeUInt32BE(crc(Buffer.concat([label,bytes])));return Buffer.concat([size,label,bytes,checksum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const pixels=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.set(pixel(x,y),y*(width*4+1)+1+x*4);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
};
