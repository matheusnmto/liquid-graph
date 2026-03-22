const fs = require('fs');
const path = require('path');
const vaultPath = '/Users/matheusfarah/Documents/liquid-graph';

const connections = [
  { source: 'PURGATORIO.md', target: 'README.md', similarity: 0.99 }
];

let saved = 0;
for (const conn of connections) {
  if (!conn.source || !conn.target) continue;
  const srcPath = path.join(vaultPath, conn.source);
  if (fs.existsSync(srcPath)) {
    let content = fs.readFileSync(srcPath, 'utf8');
    const rootName = path.basename(conn.target, '.md');
    const link = `[[${rootName}]]`;
    console.log(`[semantic] Escrevendo em ${srcPath} o link ${link} ... content includes? ${content.includes(link)}`);
    
    if (!content.includes(link)) {
      const tag = `\n\n> [!ai] Conexão Semântica Descoberta\n> ${link} (similaridade: ${(conn.similarity * 100).toFixed(0)}%)\n`;
      fs.appendFileSync(srcPath, tag, 'utf8');
      saved++;
    }
  } else {
    console.log(`ARQUIVO NAO EXISTE: ${srcPath}`);
  }
}
console.log('Saved:', saved);
