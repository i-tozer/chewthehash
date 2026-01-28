import fs from 'fs';
import path from 'path';

const outputPath = path.join(process.cwd(), 'lib', 'decoders', 'coverage.json');

const payload = {
  generated_at: new Date().toISOString().split('T')[0],
  top_packages: [],
  notes: 'Populate this file with weekly indexer output.'
};

fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
console.log(`Updated ${outputPath}`);
