const { analyzeConnections } = require('./zelador/modules/semanticLinks.js');
const { scanVault } = require('./zelador/modules/scanner.js');
const fs = require('fs');
const path = require('path');

const vaultPath = '/Users/matheusfarah/Documents/liquid-graph';

(async () => {
  const files = await scanVault(vaultPath);
  const connections = await analyzeConnections(vaultPath, files);
  console.log('Connections from Ollama:', connections);

  let saved = 0;
  for (const conn of connections) {
    if (!conn.source || !conn.target) continue;
    const srcPath = path.join(vaultPath, conn.source);
    if (fs.existsSync(srcPath)) {
      let content = fs.readFileSync(srcPath, 'utf8');
      const rootName = require('path').basename(conn.target, '.md');
      const link = `[[${rootName}]]`;
      
      console.log(`Verificando em ${srcPath} se contém o link:`, link);
      
      if (!content.includes(link)) {
        console.log('NAO CONTEM! EScrevendo...');
        const tag = `\n\n> [!ai] Conexão Semântica Descoberta\n> ${link} (similaridade: ${(conn.similarity * 100).toFixed(0)}%)\n`;
        fs.appendFileSync(srcPath, tag, 'utf8');
        saved++;
      } else {
        console.log('JÁ CONTAN AQUI DENTRO.');
      }
    }
  }
  console.log('Total a salvar:', saved);
})();
