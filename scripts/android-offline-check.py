import json,re,sqlite3,subprocess,tempfile,time,xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PACKAGE='na.agrosense.agrosense_farmer'
def adb(*args): return subprocess.check_output(['adb','-s','emulator-5554',*args],timeout=30)
def nodes():
    adb('shell','uiautomator','dump','/sdcard/agrosense-ui.xml')
    return ET.fromstring(adb('shell','cat','/sdcard/agrosense-ui.xml')).iter('node')
def tap(label):
    for n in nodes():
        value=n.get('content-desc','') or n.get('text','') or n.get('hint','')
        if label in value and n.get('enabled')=='true':
            x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
            adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2));return
    raise RuntimeError('Missing UI control: '+label)
def snapshot():
    data=adb('exec-out','run-as',PACKAGE,'cat','databases/agrosense.db')
    path=Path(tempfile.mktemp(suffix='.sqlite'))
    path.write_bytes(data)
    db=sqlite3.connect(path)
    rows=db.execute('SELECT id,ready,server_id FROM drafts').fetchall()
    db.close();path.unlink();return rows
try:
    adb('shell','svc','wifi','disable')
    adb('shell','svc','data','disable')
    tap('Save and submit crop check')
    time.sleep(2)
    adb('shell','am','force-stop',PACKAGE)
    before=snapshot();assert len(before)==1 and before[0][1]==1,before
    key=before[0][0]
    adb('shell','am','start','-n',PACKAGE+'/.MainActivity')
    time.sleep(3)
    restarted=snapshot();assert restarted[0][0]==key,restarted
    for _ in range(3): adb('shell','input','swipe','530','1850','530','650','400');time.sleep(.3)
    (ROOT/'docs/screenshots/farmer-offline-draft.png').write_bytes(adb('exec-out','screencap','-p'))
finally:
    adb('shell','svc','wifi','enable')
    adb('shell','svc','data','enable')
time.sleep(3)
tap('Sync saved work')
for _ in range(35):
    time.sleep(1)
    if not snapshot():break
else:raise AssertionError('Draft did not synchronize')
db=sqlite3.connect(ROOT/'data/agrosense.sqlite')
count=db.execute('SELECT COUNT(*) FROM cases WHERE client_submission_id=?',(key,)).fetchone()[0]
assert count==1,count
case=db.execute('SELECT id,processing_state FROM cases WHERE client_submission_id=?',(key,)).fetchone()
assert db.execute('SELECT COUNT(*) FROM jobs WHERE case_id=?',(case[0],)).fetchone()[0]==1
print(json.dumps({'passed':True,'draft_id':key,'server_case_count':count,'case_id':case[0],'checks':['device capture','offline ready draft','force-stop and restart persistence','reconnect upload','one server case and job']}))
