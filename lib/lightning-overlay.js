'use strict'
const {lonLatToTilePixel}=require('./hazard-overlay')
const zlib=require('node:zlib')
function crc32(buf){let c=0xffffffff;for(const b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc])}
function encode(buf){const raw=Buffer.alloc((256*4+1)*256);for(let y=0;y<256;y++){const o=y*(256*4+1);raw[o]=0;buf.copy(raw,o+1,y*1024,(y+1)*1024)}const ih=Buffer.alloc(13);ih.writeUInt32BE(256,0);ih.writeUInt32BE(256,4);ih[8]=8;ih[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])}
function dot(buf,x,y,age){const a=Math.max(70,255-Math.floor(age/1800000*180));for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){if(dx*dx+dy*dy>9)continue;const X=Math.round(x+dx),Y=Math.round(y+dy);if(X<0||Y<0||X>255||Y>255)continue;const i=(Y*256+X)*4;buf[i]=255;buf[i+1]=255-Math.min(200,Math.floor(age/60000)*12);buf[i+2]=20;buf[i+3]=a}}
function renderLightningTile(strikes,z,x,y,now=Date.now()){const buf=Buffer.alloc(256*256*4);for(const s of strikes||[]){const d=new Date(s.time);if(Number.isNaN(d.getTime()))continue;const age=now-d.getTime();if(age<0||age>30*60000)continue;const p=lonLatToTilePixel(s.position.longitude,s.position.latitude,z,x,y);dot(buf,p[0],p[1],age)}return encode(buf)}
module.exports={renderLightningTile}
