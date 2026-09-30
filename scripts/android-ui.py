"""Small local-emulator UI verification helper; no production devices."""
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

DEVICE = 'emulator-5554'

def adb(*args):
    return subprocess.check_output(['adb', '-s', DEVICE, *args], timeout=30)

def nodes():
    adb('shell','uiautomator','dump','/sdcard/agrosense-ui.xml')
    return ET.fromstring(adb('shell','cat','/sdcard/agrosense-ui.xml')).iter('node')

def tap(text):
    for n in nodes():
        value=n.get('content-desc','') or n.get('text','') or n.get('hint','')
        if text.lower() in value.lower() and n.get('enabled')=='true':
            x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
            adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))
            time.sleep(.8)
            print('Tapped:',value)
            return
    raise SystemExit('Not found: '+text)

command=sys.argv[1]
if command=='tap': tap(sys.argv[2])
elif command=='text': adb('shell','input','text',sys.argv[2].replace(' ','%s'))
elif command=='down': adb('shell','input','swipe','530','1850','530','650','450')
elif command=='up': adb('shell','input','swipe','530','650','530','1850','450')
elif command=='back': adb('shell','input','keyevent','4')
elif command=='dump':
    for n in nodes():
        value=n.get('content-desc','') or n.get('text','') or n.get('hint','')
        if value: print(n.get('class'),n.get('bounds'),repr(value))
elif command=='shot':
    name=sys.argv[2]
    if not re.fullmatch(r'[a-z0-9-]+',name): raise SystemExit('Invalid screenshot name')
    Path('docs/screenshots/'+name+'.png').write_bytes(adb('exec-out','screencap','-p'))
else: raise SystemExit('Unknown command')
