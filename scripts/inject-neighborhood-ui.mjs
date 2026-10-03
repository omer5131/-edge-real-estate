import fs from 'node:fs';
fs.mkdirSync('src/components',{recursive:true});
fs.copyFileSync('ui/NeighborhoodIntelligence.tsx','src/components/NeighborhoodIntelligence.tsx');
fs.copyFileSync('ui/neighborhood-intelligence.css','src/components/neighborhood-intelligence.css');
const main='src/main.tsx';
let s=fs.readFileSync(main,'utf8');
if(!s.includes('NeighborhoodIntelligenceShell')){
 s=s.replace("import EdgeP1 from './EdgeP1';","import EdgeP1 from './EdgeP1';\nimport NeighborhoodIntelligenceShell from './components/NeighborhoodIntelligence';");
 s=s.replace('<EdgeP1 />','<NeighborhoodIntelligenceShell><EdgeP1 /></NeighborhoodIntelligenceShell>');
 fs.writeFileSync(main,s);
}
console.log('Neighborhood intelligence UI injected.');
