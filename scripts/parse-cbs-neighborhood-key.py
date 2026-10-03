#!/usr/bin/env python3
import json,re,sys,urllib.request,zipfile,xml.etree.ElementTree as ET
from io import BytesIO

URL="https://www.cbs.gov.il/he/mediarelease/doclib/2022/026/%D7%A8%D7%97%D7%95%D7%91%D7%95%D7%AA%20%D7%A2%D7%99%D7%A7%D7%A8%D7%99%D7%99%D7%9D%20%D7%95%D7%A9%D7%9B%D7%95%D7%A0%D7%95%D7%AA%20%D7%9C%D7%90%D7%A1%202022.xlsx"
NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def cell_col(ref):
    m=re.match(r'([A-Z]+)',ref or '')
    if not m:return 0
    n=0
    for ch in m.group(1): n=n*26+ord(ch)-64
    return n-1

def norm(v):
    return re.sub(r'\s+',' ',str(v or '')).strip()

def tokens(v):
    v=norm(v)
    if not v:return []
    out=[]
    for p in re.split(r'\s*[,;/]\s*',v):
        p=norm(p)
        if p and p not in out: out.append(p)
    return out

req=urllib.request.Request(URL,headers={'User-Agent':'Mozilla/5.0'})
with urllib.request.urlopen(req,timeout=60) as resp:
    data=resp.read()
zf=zipfile.ZipFile(BytesIO(data))
shared=[]
if 'xl/sharedStrings.xml' in zf.namelist():
    root=ET.fromstring(zf.read('xl/sharedStrings.xml'))
    for si in root.findall('m:si',NS):
        shared.append(''.join(t.text or '' for t in si.iterfind('.//m:t',NS)))

sheet='xl/worksheets/sheet1.xml'
if sheet not in zf.namelist():
    sheet=next(x for x in zf.namelist() if x.startswith('xl/worksheets/sheet') and x.endswith('.xml'))
root=ET.fromstring(zf.read(sheet))
rows=[]
for r in root.findall('.//m:sheetData/m:row',NS):
    vals={}
    for c in r.findall('m:c',NS):
        idx=cell_col(c.attrib.get('r'))
        t=c.attrib.get('t')
        val=''
        if t=='inlineStr':
            val=''.join(x.text or '' for x in c.iterfind('.//m:t',NS))
        else:
            v=c.find('m:v',NS)
            if v is not None and v.text is not None:
                val=shared[int(v.text)] if t=='s' else v.text
        vals[idx]=norm(val)
    rows.append((int(r.attrib.get('r','0')),vals))

header_idx=None; headers={}
for rownum,vals in rows[:50]:
    joined=' | '.join(vals.values())
    if 'יישוב' in joined and 'סטטיסטי' in joined and ('שכונ' in joined or 'רחוב' in joined):
        header_idx=rownum; headers=vals; break
if header_idx is None:
    raise SystemExit('Could not detect CBS header row')

def find_col(*needles):
    for idx,h in headers.items():
        hh=norm(h)
        if all(n in hh for n in needles): return idx
    return None

c_locality=find_col('שם','יישוב')
c_code=find_col('סמל','יישוב')
c_stat=find_col('אזור','סטטיסטי')
c_neigh=find_col('שכונ')
c_street=find_col('רחוב')
required={'locality':c_locality,'code':c_code,'stat':c_stat}
if any(v is None for v in required.values()):
    raise SystemExit('Missing required CBS columns: '+json.dumps(headers,ensure_ascii=False))

out=[]
for rownum,vals in rows:
    if rownum<=header_idx: continue
    locality=norm(vals.get(c_locality,'')); code=norm(vals.get(c_code,'')); stat=norm(vals.get(c_stat,''))
    if not locality or not code or not stat: continue
    code=re.sub(r'\.0+$','',code); stat=re.sub(r'\.0+$','',stat)
    neigh=norm(vals.get(c_neigh,'')) if c_neigh is not None else ''
    street=norm(vals.get(c_street,'')) if c_street is not None else ''
    out.append({
      'locality_code':code,'locality_name':locality,'statistical_area_code':stat,
      'neighborhood_names_raw':neigh or None,'main_streets_raw':street or None,
      'neighborhood_names':tokens(neigh),'main_streets':tokens(street),
      'source_url':URL,'source_row':rownum,'source_version':'cbs-2022',
      'raw':{str(k):v for k,v in vals.items()}
    })
json.dump({'source_url':URL,'header_row':header_idx,'headers':headers,'rows':out},sys.stdout,ensure_ascii=False)
