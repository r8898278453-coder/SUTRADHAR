const fs=require('node:fs');const path=require('node:path');
const src=path.resolve('v7/ui'),dest=path.resolve('dist');fs.mkdirSync(dest,{recursive:true});
for(const file of fs.readdirSync(src)){fs.copyFileSync(path.join(src,file),path.join(dest,file));}
console.log('V7 live control dashboard copied into dist.');
