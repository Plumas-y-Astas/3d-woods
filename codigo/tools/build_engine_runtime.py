import subprocess,re,zipfile,hashlib,json,argparse
from pathlib import Path
parser=argparse.ArgumentParser(description='Pack the official extracted Windows CuraEngine runtime, without the Cura GUI.')
parser.add_argument('cura_directory',type=Path,help='Directory containing CuraEngine.exe and official DLLs')
args=parser.parse_args()
root=args.cura_directory.resolve();project=Path(__file__).resolve().parents[1];index={}
for p in root.rglob('*.dll'):index.setdefault(p.name.lower(),[]).append(p)
seen=set();queue=[root/'CuraEngine.exe'];chosen=[]
while queue:
 p=queue.pop()
 if p.name.lower() in seen:continue
 seen.add(p.name.lower());chosen.append(p)
 text=subprocess.check_output(['objdump','-p',str(p)],text=True,stderr=subprocess.DEVNULL)
 for name in re.findall(r'DLL Name:\s*(\S+)',text):
  if name.lower() in index:queue.append(sorted(index[name.lower()],key=lambda p:len(p.parts))[0])
entries={p.name:p for p in chosen}
for name in ['fdmprinter.def.json','fdmextruder.def.json']:
 entries['resources/definitions/'+name]=root/'share/cura/resources/definitions'/name
sources=project/'third_party/CuraEngine'
for p in sources.glob('*LICENSE*'):entries['licenses/'+p.name]=p
manifest={name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in entries.items()}
payload=project/'engine/windows-x64.zip'
with zipfile.ZipFile(payload,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name,p in entries.items():z.write(p,name)
 z.writestr('files.json',json.dumps(manifest,indent=2))
meta={'version':'5.13.0','archive':payload.name,'sha256':hashlib.sha256(payload.read_bytes()).hexdigest(),'source':'https://github.com/Ultimaker/Cura/releases/tag/5.13.0','files':len(entries)}
(project/'engine/runtime.json').write_text(json.dumps(meta,indent=2))
(project/'engine/README.md').write_text('Motor local CuraEngine 5.13.0 para Windows x64. Binarios oficiales sin modificar. El ejecutable de 3D-Woods incluye este paquete y lo extrae en su caché local. Fuentes, licencias y procedencia en third_party/CuraEngine.\n')
print(json.dumps({'payload_bytes':payload.stat().st_size,**meta}))
