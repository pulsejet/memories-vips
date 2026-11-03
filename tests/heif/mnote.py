#!/usr/bin/env python3
"""Print Apple maker note HDR tags 0x21/0x30 and the derived headroom.

  python3 -I mnote.py FILE.heic [...]

Cross-check for heifload's maker-note path (Apple's published formula).
"""
import sys,struct
def headroom(m33,m48):
    if m33<1.0: stops=-20*m48+1.8 if m48<=0.01 else -0.101*m48+1.601
    else: stops=-70*m48+3.0 if m48<=0.01 else -0.303*m48+2.303
    return 2**max(stops,0)
for f in sys.argv[1:]:
    b=open(f,'rb').read(); i=b.find(b"Apple iOS\0")
    if i<0: print(f,"no apple mnote"); continue
    bo='>' if b[i+12:i+14]==b'MM' else '<'
    n=struct.unpack(bo+'H',b[i+14:i+16])[0]; vals={}
    for k in range(n):
        e=b[i+16+12*k:i+28+12*k]; tag,typ,cnt,off=struct.unpack(bo+'HHII',e)
        if tag in (0x21,0x30):
            if typ in (5,10):
                fmt=bo+('II' if typ==5 else 'ii'); nu,de=struct.unpack(fmt,b[i+off:i+off+8]); vals[tag]=nu/de
            else: vals[tag]=(typ,off)
    m33,m48=vals.get(0x21),vals.get(0x30)
    print(f, "m33",m33,"m48",m48, "headroom", headroom(m33,m48) if isinstance(m33,float) and isinstance(m48,float) else None)
