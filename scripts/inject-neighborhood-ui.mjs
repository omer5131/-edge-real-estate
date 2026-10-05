import fs from 'node:fs';
fs.mkdirSync('src/components',{recursive:true});
fs.copyFileSync('ui/NeighborhoodIntelligence.tsx','src/components/NeighborhoodIntelligence.tsx');
fs.copyFileSync('ui/OpenStreetIntelligenceMap.tsx','src/components/OpenStreetIntelligenceMap.tsx');
fs.copyFileSync('ui/ExternalDataIntake.tsx','src/components/ExternalDataIntake.tsx');
fs.copyFileSync('ui/external-data-intake.css','src/components/external-data-intake.css');
fs.copyFileSync('ui/neighborhood-intelligence.css','src/components/neighborhood-intelligence.css');
fs.copyFileSync('ui/DealWorkflow.tsx','src/components/DealWorkflow.tsx');
fs.copyFileSync('ui/MyDeals.tsx','src/components/MyDeals.tsx');
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


let phase3=fs.readFileSync(edge,'utf8');
if(!phase3.includes("import MyDeals from './components/MyDeals';")){
  phase3=phase3.replace("import DealRoom from './components/DealRoom';","import DealRoom from './components/DealRoom';\nimport MyDeals from './components/MyDeals';");
}
phase3=phase3.replace("useState<'radar'|'research'|'opps'|'area'|'data'|'admin'|'property'>('radar')","useState<'radar'|'research'|'opps'|'deals'|'area'|'data'|'admin'|'property'>('radar')");
phase3=phase3.replace("['radar','רדאר',MapPinned],['research','מחקר',Search],['opps','הזדמנויות',Target],['area','אזור',Layers3]","['radar','רדאר',MapPinned],['research','מחקר',Search],['opps','הזדמנויות',Target],['deals','My Deals',Bookmark],['area','אזור',Layers3]");
if(!phase3.includes("{tab==='deals'&&<MyDeals")){
 phase3=phase3.replace("{tab==='opps'&&<Opportunities items={data.opportunities||[]} onOpen={x=>{setProperty(x);setTab('property')}}/>}","{tab==='opps'&&<Opportunities items={data.opportunities||[]} onOpen={x=>{setProperty(x);setTab('property')}}/>}\n        {tab==='deals'&&<MyDeals onOpen={x=>{setProperty(x as any);setTab('property')}}/>}");
}
fs.writeFileSync(edge,phase3);
console.log('Phase 3 My Deals UI injected.');


/* Phase 3 area-to-deal bridge */
let bridge=fs.readFileSync(edge,'utf8');
if(!bridge.includes("edge:open-listing")){
 bridge=bridge.replace(
   "  useEffect(()=>{load();},[]);",
   `  useEffect(()=>{load();},[]);
  useEffect(()=>{
    const openListing=(event:Event)=>{
      const detail=(event as CustomEvent).detail;
      if(detail?.id){setProperty(detail as any);setTab('property');}
    };
    const openDeals=()=>setTab('deals');
    window.addEventListener('edge:open-listing',openListing as EventListener);
    window.addEventListener('edge:open-deals',openDeals);
    return()=>{
      window.removeEventListener('edge:open-listing',openListing as EventListener);
      window.removeEventListener('edge:open-deals',openDeals);
    };
  },[]);`
 );
}
fs.writeFileSync(edge,bridge);
console.log('Phase 3 Area Intelligence → Deal bridge injected.');

const edgePath='src/EdgeP1.tsx';
if(fs.existsSync(edgePath)){
 let edge=fs.readFileSync(edgePath,'utf8');
 if(!edge.includes("import ExternalDataIntake from")) edge="import ExternalDataIntake from './components/ExternalDataIntake';\n"+edge;
 if(!edge.includes("<ExternalDataIntake/><DataExplorer/>")) edge=edge.replace("<DataExplorer/><DataConsole status={status}/>","<ExternalDataIntake/><DataExplorer/><DataConsole status={status}/>");
 fs.writeFileSync(edgePath,edge,'utf8');
}

// First-class renewal project directory and URL-backed navigation.
fs.copyFileSync('ui/RenewalProjects.tsx','src/components/RenewalProjects.tsx');
fs.copyFileSync('ui/renewal-projects.css','src/components/renewal-projects.css');
let renewalUi=fs.readFileSync(edgePath,'utf8');
if(!renewalUi.includes("import RenewalProjects from")) renewalUi="import RenewalProjects from './components/RenewalProjects';\n"+renewalUi;
renewalUi=renewalUi.replace("|'property'>('radar')","|'property'|'renewal'>('radar')");
renewalUi=renewalUi.replace("const [tab,setTab]=useState<", "const [tab,setTabState]=useState<");
if(!renewalUi.includes('const [projectId,setProjectId]')){
 renewalUi=renewalUi.replace('  const [area,setArea]=useState<Area|null>(null);',`  const [projectId,setProjectId]=useState<string|null>(null);
  const [returnRoute,setReturnRoute]=useState('#/research');
  const setTab=(next:any)=>{setTabState(next);if(next!=='property')location.hash='#/'+next;};
  const [area,setArea]=useState<Area|null>(null);`);
 renewalUi=renewalUi.replace('  useEffect(()=>{load();},[]);',`  useEffect(()=>{load();},[]);
  useEffect(()=>{
    let previous=location.hash||'#/radar';
    const route=()=>{
      const parts=location.hash.slice(2).split('/');
      const page=parts[0]||'radar';
      if(page==='renewal'){setProjectId(parts[1]||null);setTabState('renewal');}
      else if(page==='property'&&parts[1]){
        if(!previous.startsWith('#/property/'))setReturnRoute(previous.startsWith('#/')?previous:'#/research');
        setProperty(current=>current?.id===parts[1]?current:({id:parts[1],address:'טוען נכס…'} as any));setTabState('property');
      }else if(['radar','research','opps','deals','area','data','admin'].includes(page))setTabState(page as any);
      previous=location.hash||'#/radar';
    };
    route();window.addEventListener('hashchange',route);
    return()=>window.removeEventListener('hashchange',route);
  },[]);
  useEffect(()=>{if(tab==='property'&&property?.id&&location.hash!=='#/property/'+property.id)location.hash='#/property/'+property.id;},[tab,property?.id]);`);
}
renewalUi=renewalUi.replace("['deals','My Deals',Bookmark]","['deals','העסקאות שלי',Bookmark],['renewal','פרויקטים',Layers3]");
if(!renewalUi.includes("{tab==='renewal'&&<RenewalProjects")) renewalUi=renewalUi.replace("{tab==='admin'&&<Admin/>}","{tab==='admin'&&<Admin/>}\n        {tab==='renewal'&&<RenewalProjects projectId={projectId} onOpenListing={x=>{setProperty(x as any);setTab('property')}}/>}");
renewalUi=renewalUi.replace("onBack={()=>setTab('opps')}","onBack={()=>{location.hash=returnRoute}}");
// The old Areas tab hid the richer map behind a floating secondary entrypoint.
renewalUi=renewalUi.replace("onClick={()=>setTab(id as any)}", "onClick={()=>{if(id==='area')location.hash='#/areas';else setTab(id as any)}}");
renewalUi=renewalUi.replace(/(?:<ExternalDataIntake\/>){2,}/g,'<ExternalDataIntake/>').replace(/[ \t]+$/gm,'');
fs.writeFileSync(edgePath,renewalUi);

// All radar/legacy area entrypoints share the canonical map.
let unified=fs.readFileSync(edgePath,'utf8');
unified=unified.replace("onArea={a=>{setArea(a);setTab('area')}}", "onArea={a=>{location.hash='#/areas?neighborhoodId='+a.id}}");
fs.writeFileSync(edgePath,unified);
