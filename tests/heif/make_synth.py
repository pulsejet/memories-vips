#!/usr/bin/env python3
"""Generate metadata-edited copies of the Apple v1 sample into samples/synth/.

All edits keep byte length identical (iloc offsets stay valid), so libheif
decodes the real pixels; only the gainmap metadata path changes.

  synth_iso_hdrgm_minimal.heic     hdrgm: XMP with only GainMapMax/HDRCapacityMax
                                   (spec defaults + use_base_cg) -> UHDR, boost 4
  synth_apple_attr_headroom3.heic  Apple XMP, headroom as attribute -> UHDR, boost 3
  synth_apple_noheadroom.heic      maker note signature broken -> SDR fallback
  synth_badxml.heic                malformed XMP + no maker note -> SDR fallback
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(HERE, "samples", "apple-v1-iphone13pro.heic")
out = os.path.join(HERE, "samples", "synth")
os.makedirs(out, exist_ok=True)
b = open(src, "rb").read()
s = b.rfind(b"<x:xmpmeta", 0, b.find(b"xmlns:HDRGainMap"))
e = b.find(b"</x:xmpmeta>", s) + 12
n = e - s

def put(xml):
    x = xml.encode()
    assert len(x) <= n, (len(x), n)
    x = x[:-12] + b" " * (n - len(x)) + x[-12:]
    return b[:s] + x + b[e:]

def no_makernote(blob):
    r = blob.replace(b"Apple iOS\0", b"Apple XXX\0", 1)
    assert r != blob
    return r

RDF = ('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
       'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">')
files = {
    "synth_iso_hdrgm_minimal.heic": put(
        RDF + '<rdf:Description xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" '
        'hdrgm:GainMapMax="2" hdrgm:HDRCapacityMax="2"/></rdf:RDF></x:xmpmeta>'),
    "synth_apple_attr_headroom3.heic": put(
        RDF + '<rdf:Description xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/" '
        'HDRGainMap:HDRGainMapVersion="131072" HDRGainMap:HDRGainMapHeadroom="3.0"/>'
        '</rdf:RDF></x:xmpmeta>'),
    "synth_apple_noheadroom.heic": no_makernote(b),
    "synth_badxml.heic": no_makernote(put("<x:xmpmeta><<<not xml</x:xmpmeta>")),
}
for name, blob in files.items():
    open(os.path.join(out, name), "wb").write(blob)
print("wrote", len(files), "files to", out)
