"""Innenraum des Low-Poly-E30 (ROH3D, Sketchfab 9dea494b…, CC BY) in den [FREE] BMW M3 E30 (Martin Trafas,
ac3c7013…, CC BY) einsetzen – einmalig 2026-11-20 gelaufen (Ergebnis liegt auf Prod in data/car-rain und data/car-cache,
Originale in /root/e30-vor-innenraum). Aufruf im Ordner mit low.glb und free.glb: python3 graft_e30_interior.py [r_cm=3]

Ausrichtung: Low-Poly in mm, Länge entlang x (vorn = −x) → FREE in m, Länge entlang z (vorn = +z); Maßstab aus dem
Radstand (2,569 → 2,591 m), Achsen deckungsgleich. Innenraum = Body-Dreiecke im Kabinenquader, die mehr als r cm von
jeder FREE-Ecke entfernt sind (die Außenhaut des Low-Poly liegt auf der FREE-Hülle und fällt so heraus).
"""
import json,struct,numpy as np
def load(f):
    b=open(f,"rb").read(); n=struct.unpack_from("<I",b,12)[0]; g=json.loads(b[20:20+n])
    off=20+n; bl=struct.unpack_from("<I",b,off)[0]; return g,b[off+8:off+8+bl]
CT={5126:np.float32,5123:np.uint16,5125:np.uint32,5121:np.uint8}
NC={"SCALAR":1,"VEC2":2,"VEC3":3,"VEC4":4}
def acc(g,bin_,i):
    a=g["accessors"][i]; bv=g["bufferViews"][a["bufferView"]]; dt=CT[a["componentType"]]; nc=NC[a["type"]]
    sz=np.dtype(dt).itemsize; st=bv.get("byteStride",0); o=bv.get("byteOffset",0)+a.get("byteOffset",0)
    if st and st!=nc*sz:
        raw=np.frombuffer(bin_,np.uint8,a["count"]*st,o).reshape(a["count"],st)
        return raw[:,:nc*sz].copy().view(dt).reshape(a["count"],nc)
    return np.frombuffer(bin_,dt,a["count"]*nc,o).reshape(a["count"],nc).copy()
def mat(nd):
    M=np.eye(4)
    if "matrix" in nd: return np.array(nd["matrix"]).reshape(4,4).T
    t=nd.get("translation",[0,0,0]); r=nd.get("rotation",[0,0,0,1]); s=nd.get("scale",[1,1,1])
    x,y,z,w=r; R=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    M[:3,:3]=R*np.array(s); M[:3,3]=t; return M
def world(g):
    out={}
    def rec(i,P):
        W=P@mat(g["nodes"][i]); out[i]=W
        for c in g["nodes"][i].get("children",[]): rec(c,W)
    for r in g["scenes"][g.get("scene",0)]["nodes"]: rec(r,np.eye(4))
    return out

s=2.591/2569; c=0.4302; d=0.311-307*s
def tf(P): return np.c_[P[:,2]*s, P[:,1]*s+d, -P[:,0]*s+c]
def free_pts():
    gf,bf=load("free.glb"); Wf=world(gf); F=[]
    for i,nd in enumerate(gf["nodes"]):
        if "mesh" not in nd: continue
        for p in gf["meshes"][nd["mesh"]]["primitives"]:
            P=acc(gf,bf,p["attributes"]["POSITION"]).astype(float); F.append((np.c_[P,np.ones(len(P))]@Wf[i].T)[:,:3])
    return np.vstack(F)
CELL=0.01; LO=np.array([-1.0,-0.05,-2.3])
def near_grid(F, r):
    shp=(np.array([2.0,1.5,4.5])/CELL).astype(int)+1
    G=np.zeros(shp,bool); k=((F-LO)/CELL).astype(int); k=np.clip(k,0,shp-1); G[k[:,0],k[:,1],k[:,2]]=True
    for ax in range(3):
        H=G.copy()
        for sft in range(1,r+1):
            H|=np.roll(G,sft,ax); H|=np.roll(G,-sft,ax)
        G=H
    return G
def is_near(G,C):
    k=np.clip(((C-LO)/CELL).astype(int),0,np.array(G.shape)-1); return G[k[:,0],k[:,1],k[:,2]]

import sys
R = int(sys.argv[1]) if len(sys.argv) > 1 else 3
g,b=load("low.glb"); W=world(g)
gf,bf=load("free.glb")
# Innenraum-Dreiecke wählen
for i,nd in enumerate(g["nodes"]):
    if "mesh" not in nd: continue
    for p in g["meshes"][nd["mesh"]]["primitives"]:
        if g["materials"][p["material"]]["name"]=="Body": prim,Wi=p,W[i]
P0=acc(g,b,prim["attributes"]["POSITION"]).astype(float)
P=tf((np.c_[P0,np.ones(len(P0))]@Wi.T)[:,:3])
Nm=acc(g,b,prim["attributes"]["NORMAL"]).astype(float); Nm=Nm@Wi[:3,:3].T; Nm/=np.linalg.norm(Nm,axis=1,keepdims=True)+1e-12
Nm=np.c_[Nm[:,2],Nm[:,1],-Nm[:,0]]
UV=acc(g,b,prim["attributes"]["TEXCOORD_0"]).astype(np.float32)
I=acc(g,b,prim["indices"]).reshape(-1,3); C=P[I].mean(1)
box=(abs(C[:,0])<0.80)&(C[:,1]>0.30)&(C[:,1]<1.30)&(C[:,2]>-1.2)&(C[:,2]<1.05)
G=near_grid(free_pts(),R); sel=box&~is_near(G,C)
I=I[sel]; used=np.unique(I); remap=-np.ones(len(P),int); remap[used]=np.arange(len(used))
I2=remap[I].astype(np.uint32).ravel(); P2=P[used].astype(np.float32); N2=Nm[used].astype(np.float32); U2=UV[used]
print("Innenraum-Dreiecke", len(I), "Ecken", len(used))
# Binärdaten anhängen
blob=bytearray(bf)
def pad():
    while len(blob)%4: blob.append(0)
def view(data, target=None):
    pad(); off=len(blob); blob.extend(data)
    v={"buffer":0,"byteOffset":off,"byteLength":len(data)}
    if target: v["target"]=target
    gf["bufferViews"].append(v); return len(gf["bufferViews"])-1
def accessor(arr, typ, ct, target, mm=False):
    vi=view(arr.tobytes(), target)
    a={"bufferView":vi,"componentType":ct,"count":int(arr.shape[0] if arr.ndim>1 else arr.size),"type":typ}
    if mm: a["min"]=arr.min(0).tolist(); a["max"]=arr.max(0).tolist()
    gf["accessors"].append(a); return len(gf["accessors"])-1
aP=accessor(P2,"VEC3",5126,34962,True); aN=accessor(N2,"VEC3",5126,34962); aU=accessor(U2,"VEC2",5126,34962)
aI=accessor(I2,"SCALAR",5125,34963)
# Texturen des Low-Poly-Body übernehmen (Grundfarbe, Metall/Rauheit, Normalen)
gf.setdefault("samplers",[]).append(g["samplers"][0]); smp=len(gf["samplers"])-1
def tex(ti):
    im=g["images"][g["textures"][ti]["source"]]; v=g["bufferViews"][im["bufferView"]]
    data=b[v.get("byteOffset",0):v.get("byteOffset",0)+v["byteLength"]]
    gf["images"].append({"bufferView":view(data),"mimeType":im["mimeType"],"name":"e30_interior_%d"%ti})
    gf["textures"].append({"sampler":smp,"source":len(gf["images"])-1}); return len(gf["textures"])-1
m=g["materials"][prim["material"]]; pb=m["pbrMetallicRoughness"]
mat={"name":"E30_INTERIOR","doubleSided":True,"pbrMetallicRoughness":{"baseColorTexture":{"index":tex(pb["baseColorTexture"]["index"])},
     "metallicRoughnessTexture":{"index":tex(pb["metallicRoughnessTexture"]["index"])}}}
# Normalenkarte weglassen: ohne TANGENT-Daten würde three.js sie falsch berechnen (Low-Poly-Flächen sind glatt genug)
gf["materials"].append(mat)
gf["meshes"].append({"name":"E30_INTERIOR","primitives":[{"attributes":{"POSITION":aP,"NORMAL":aN,"TEXCOORD_0":aU},"indices":aI,"material":len(gf["materials"])-1}]})
gf["nodes"].append({"name":"E30_INTERIOR","mesh":len(gf["meshes"])-1})
gf["scenes"][gf.get("scene",0)]["nodes"].append(len(gf["nodes"])-1)
pad(); gf["buffers"][0]["byteLength"]=len(blob)
gf.setdefault("asset",{})["extras"]={"note":"Innenraum aus 'Low Poly Car - BMW E30 1985 White' von ROH3D (CC BY 4.0) eingesetzt"}
js=json.dumps(gf,separators=(",",":")).encode();
while len(js)%4: js+=b" "
out=struct.pack("<III",0x46546C67,2,12+8+len(js)+8+len(blob))+struct.pack("<II",len(js),0x4E4F534A)+js+struct.pack("<II",len(blob),0x004E4942)+bytes(blob)
open("free_interior.glb","wb").write(out); print("geschrieben", len(out))
