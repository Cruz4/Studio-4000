// Export the UI's actual banks for validation against the native parameter schema.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('../ui/node_modules/typescript');
async function readModule(path) {
  const js = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}
const presets = await readModule('../ui/src/components/fx/presets.ts');
const { GENERIC_PRESETS } = await readModule('../ui/src/components/fx/genericPresets.ts');
const types = { s4000eq:'EQ', '4bandEq':'CLASSIC_EQ', s4000comp:'COMP', compressor:'CLASSIC_COMP', s4000limiter:'LIMITER', s4000gate:'GATE', s4000deesser:'DEESSER', s4000transient:'TRANSIENT', s4000tune:'TUNE', s4000saturator:'SATURATOR', s4000crusher:'CRUSHER', chorus:'CHORUS', s4000delay:'DELAY', s4000doubler:'DOUBLER', s4000width:'WIDTH', s4000tremolo:'TREMOLO', reverb:'REVERB' };
const banks = { ...GENERIC_PRESETS };
for (const [type, bank] of Object.entries(types)) banks[type] = presets[bank + '_PRESETS'];
writeFileSync(new URL('../effect-presets.test.json', import.meta.url), JSON.stringify(banks, null, 2));
writeFileSync(new URL('../track-chains.test.json', import.meta.url), readFileSync(new URL('../ui/src/data/trackChains.json', import.meta.url), 'utf8'));
console.log('Exported', Object.values(banks).reduce((n,b) => n+b.length, 0), 'actual presets.');
