const fs = require('fs');
let text = fs.readFileSync('functions/src/index.ts', 'utf8');
text = text.replace(/\0/g, '');
const lines = text.split('\n');
const cleanLines = [];
for (const line of lines) {
  if (line.includes('s c h e d u l e d A l l e g r o D i s p a t c h e r')) continue;
  if (line.includes('scheduledAllegroDispatcher')) continue;
  cleanLines.push(line);
}
cleanLines.push('export { scheduledAllegroDispatcher, processAllegroSync } from "./allegro/scheduled";');
fs.writeFileSync('functions/src/index.ts', cleanLines.join('\n'));
console.log('Fixed index ');
