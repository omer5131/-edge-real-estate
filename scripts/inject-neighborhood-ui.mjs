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


const edge='src/EdgeP1.tsx';
let edgeSource=fs.readFileSync(edge,'utf8');
if(!edgeSource.includes("import DealRoom from './components/DealRoom';")){
 edgeSource=edgeSource.replace("import DataExplorer from './components/DataExplorer';","import DataExplorer from './components/DataExplorer';\nimport DealRoom from './components/DealRoom';");
}
if(!edgeSource.includes('const [askContext,setAskContext]')){
 edgeSource=edgeSource.replace("  const [askOpen,setAskOpen]=useState(false);","  const [askOpen,setAskOpen]=useState(false);\n  const [askContext,setAskContext]=useState<any>(null);");
}
edgeSource=edgeSource.replace('onClick={()=>setAskOpen(true)}><MessageSquare size={15}/>Ask Edge</button>','onClick={()=>{setAskContext(null);setAskOpen(true)}}><MessageSquare size={15}/>Ask Edge</button>');
edgeSource=edgeSource.replace("{tab==='property'&&property&&<PropertyView item={property} onBack={()=>setTab('opps')}/>}","{tab==='property'&&property&&<DealRoom item={property} onBack={()=>setTab('opps')} onAsk={ctx=>{setAskContext(ctx);setAskOpen(true)}}/>}");
edgeSource=edgeSource.replace('<EdgeAgentDrawer open={askOpen} onClose={()=>setAskOpen(false)}/>','<EdgeAgentDrawer open={askOpen} onClose={()=>setAskOpen(false)} context={askContext}/>');
fs.writeFileSync(edge,edgeSource);

const drawer='src/components/EdgeAgentDrawer.tsx';
let drawerSource=fs.readFileSync(drawer,'utf8');
if(!drawerSource.includes('type PageContext=')){
 drawerSource=drawerSource.replace("export default function EdgeAgentDrawer({open,onClose}:{open:boolean;onClose:()=>void}){","type PageContext={entity_type?:string;listing_id?:string;property_id?:string|null;building_id?:string|null;neighborhood_id?:string|null;active_tab?:string;label?:string};\nexport default function EdgeAgentDrawer({open,onClose,context}:{open:boolean;onClose:()=>void;context?:PageContext|null}){");
}
drawerSource=drawerSource.replace('body:JSON.stringify({question:q,history})','body:JSON.stringify({question:q,history,context:context||undefined})');
drawerSource=drawerSource.replace('<div><strong>Ask Edge</strong><span>DeepSeek assistant · SQL agent tool</span></div>',"<div><strong>Ask Edge</strong><span>{context?.label?'Context: '+context.label:'DeepSeek assistant · SQL agent tool'}</span></div>");
fs.writeFileSync(drawer,drawerSource);

const dealCss=fs.readFileSync('ui/deal-room.css','utf8');
const p1='src/p1.css';
let p1Css=fs.readFileSync(p1,'utf8');
if(!p1Css.includes('/* Phase 2 Deal Room */')) p1Css+='\n'+dealCss+'\n';
fs.writeFileSync(p1,p1Css);

console.log('Phase 2 Deal Room UI injected.');
