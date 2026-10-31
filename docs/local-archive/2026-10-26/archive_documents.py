"""Rebuild this document archive from the original local outputs/research folders.

This script copies documents, never runtime workspaces or configurations. Source
files are not changed. The archive records content hashes and privacy rewrites.
"""
from pathlib import Path
from collections import Counter, defaultdict
from urllib.parse import unquote, urlparse
import argparse, hashlib, html, json, os, re, shutil

parser=argparse.ArgumentParser()
parser.add_argument('--workspace-root', required=True)
args=parser.parse_args()
ROOT=Path(args.workspace_root).resolve()
DEST=Path(__file__).resolve().parent
SOURCES=[ROOT/'outputs',ROOT/'research']
previous_manifest_path=DEST/'manifest.json'
previous_entries=(json.loads(previous_manifest_path.read_text(encoding='utf-8')).get('files',[])
                  if previous_manifest_path.is_file() else [])

PRUNE_NAMES={
 'node_modules','.git','.omx','__pycache__','runtime','profile','workspace','pi',
 'cache','uv-cache','tmp','temp','review-tmp','test-temp','official-plugins',
 'optional-plugins','builder-cache','source','reference','host-repo','plugins-repo',
 'app','plugin','plugins','files','installer','installation','prepared-installers',
 'package','staging','staged-policy','locked-packages','downloads','validated-optional',
 'optional-source','core','optional','backups','backup','db-backup','database-backup',
 'model-config-backup','after','captured','component','plugin-staging','plugin-final-index',
 'installed-transport-1','installed-transport-2','backend-temp','task-diff','session-diff',
 'published','export-inspection','static-print-poc','openclaude-conversation-source',
 'frozen-files',
 'backend','frontend','docs','modules','packages','src','reconstructed-baseline',
 'review-after','auto-factor-baseline',
}
PRUNE_RE=re.compile(r'^(before(?:-|$)|.*-before(?:-|$)|previous(?:-|$)|backup(?:-|$)|.*-backup(?:-|$)|bundle(?:s)?(?:-|$)|staging(?:-|$)|running-ui-backup|\.fixture|\.loc-inputs|node-compile-cache|history-reset|real-model|crash-|store-probe|utility-probe|site-deploy-|raw-before|incomplete-backup|metadata-before|baseline$|fixtures$|fixture-|static-debug-|update-[A-Za-z0-9]{6}$)')
SKIP_FILE_RE=re.compile(r'(?i)^(?:installer-contents|expanded-text|pdf-extracted|extracted-raw|host-.*\.txt|local-untracked|run-tail|runtime-bootstrap|frontend-index|index\.before|native-ci-.*\.txt|rendered-report|reset-log|ui-before|clean-context-seed|after-reply|live-replies|master-summary-before|design-runtime-README|design-system-runtime-README|sec-visible-text|official-sec-annual-text|exact-2MiB|reports-prompt-head\.md$)')
TEXT_EXT={'.md','.txt','.html','.csv','.json','.py','.js','.mjs','.css','.svg'}
EXTRA_FILES={
 'outputs/build-research-catalog-20261026.py',
 'outputs/verify-research-catalog-20261026.py',
 'outputs/update-default-guide-summary-20261026.py',
 'outputs/研究报告体系-Trading-Central-Autochartist与Sesame-20261026-字段字典.json',
 'outputs/研究报告体系-Trading-Central-Autochartist与Sesame-20261026-核验.json',
 'outputs/默认插件-整理后提示词计数-20261026.json',
 'outputs/research-catalog-check-20261026/render-check.json',
 'outputs/research-catalog-check-20261026/cover.png',
 'outputs/research-catalog-check-20261026/dictionary.png',
 'outputs/research-catalog-check-20261026/mobile.png',
}

EMAIL=re.compile(r'(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
TOKEN=re.compile(r'\b(?:sk-(?:proj-)?[A-Za-z0-9_\-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b')
SECRET=re.compile(r'(?i)(\b(?:api[_ -]?(?:key|secret)|secret[_ -]?key|access[_ -]?token|authorization|password|passwd|client[_ -]?secret)[\x22\x27`]?\s*[=:：]\s*[\x22\x27`]?)([A-Za-z0-9_./+\-=]{16,})')
ACCOUNT=re.compile(r'(?i)(?:\b(?:account(?:_id|Id|_login)?|login|ticket|position(?:_id)?|order(?:_id)?)\b|账户|账号|帳戶|登录号|訂單號|订单号|持仓号|单号)(?:\s|[\x22\x27`*=:：#]|为|是|<[^>]{0,80}>){0,20}(\d{5,})')
PRIVATE_KEY=re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----.*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',re.S)
PROFILE_PATH=re.compile(r'(?i)C:[/\\]Users[/\\][^/\\\s]+[/\\](?:AppData|\.codex)[^\s<>\x22\x27)]*')

chosen={};excluded=[];pruned=[];scanned=0
for source in SOURCES:
 for cur,dirs,files in os.walk(source):
  keep=[]
  for d in dirs:
   path=Path(cur,d)
   if d in PRUNE_NAMES or PRUNE_RE.match(d):
    pruned.append({'path':path.relative_to(ROOT).as_posix(),'reason':'runtime_dependency_backup_or_source_snapshot'})
   else:keep.append(d)
  dirs[:]=keep
  for fn in files:
   p=Path(cur,fn);rel=p.relative_to(ROOT).as_posix();scanned+=1
   if p.suffix.lower() not in {'.md','.txt','.html','.csv','.pdf'}:continue
   reason=None
   if SKIP_FILE_RE.match(fn):reason='raw_trace_extract_or_copied_reference'
   elif p.suffix.lower()=='.txt' and p.stat().st_size>100000:reason='large_raw_text'
   elif p.suffix.lower()=='.html' and ('.before.' in fn or '-before' in fn):reason='before_build_snapshot'
   elif p.suffix.lower()=='.pdf' and not re.search('[\u4e00-\u9fff]',fn):reason='synthetic_export_probe'
   if reason:excluded.append({'path':rel,'reason':reason})
   else:chosen[rel]=p
for rel in EXTRA_FILES:
 if (ROOT/rel).is_file():chosen[rel]=ROOT/rel

# Add only explicitly referenced local resources that live in allowed input roots.
dependencies=[]
for rel,p in list(chosen.items()):
 if p.suffix.lower() not in {'.html','.md'}:continue
 t=p.read_text(encoding='utf-8')
 refs=re.findall(r'!\[[^\]]*\]\(([^)]+)\)',t)
 if p.suffix.lower()=='.html':
  refs+=re.findall(r'<(?:script|img|source)[^>]+src=[\x22\x27]([^\x22\x27]+)',t,re.I)
  refs+=re.findall(r'<link[^>]+href=[\x22\x27]([^\x22\x27]+)',t,re.I)
 for ref in refs:
  ref=unquote(html.unescape(ref.strip('<>')))
  if re.match(r'^(https?:|data:|#|//)',ref):continue
  q=(Path(ref) if re.match(r'^[A-Za-z]:',ref) else p.parent/ref).resolve()
  if not any(q.is_relative_to(s) for s in SOURCES) or not q.is_file():continue
  if q.suffix.lower() not in TEXT_EXT|{'.png','.jpg','.jpeg','.webp','.woff','.woff2'}:continue
  qr=q.relative_to(ROOT).as_posix()
  chosen[qr]=q;dependencies.append({'from':rel,'resource':qr})

try:
 import fitz
except ImportError:
 fitz=None
texts={};pdf_text={};sensitive_values=set()
for rel,p in chosen.items():
 if p.suffix.lower() in TEXT_EXT:
  texts[rel]=p.read_text(encoding='utf-8-sig')
 elif p.suffix.lower()=='.pdf':
  if fitz is None:raise RuntimeError('PyMuPDF required to inspect report PDFs before publication')
  with fitz.open(p) as doc:pdf_text[rel]='\n'.join(page.get_text() for page in doc)
for t in list(texts.values())+list(pdf_text.values()):
 decoded=html.unescape(t)
 sensitive_values.update(m.group(1) for m in ACCOUNT.finditer(decoded))
 sensitive_values.update(EMAIL.findall(decoded))
 sensitive_values.update(TOKEN.findall(decoded))
 sensitive_values.update(m.group(2) for m in SECRET.finditer(decoded) if not re.fullmatch(r'[A-Z_]+',m.group(2)))

def redact(t):
 counts=Counter()
 for val in sorted(sensitive_values,key=lambda x:-len(x)):
  if val in t:
   n=t.count(val);t=t.replace(val,'REDACTED_IDENTIFIER');counts['account_order_email_or_credential']+=n
 t,n=PRIVATE_KEY.subn('[REDACTED_PRIVATE_KEY]',t);counts['private_key']+=n
 # Local user/profile locations are not portable; retain only a generic marker.
 t,n=PROFILE_PATH.subn('%LOCAL_USER_PROFILE%',t);counts['local_profile_path']+=n
 return t,{k:v for k,v in counts.items() if v}

rewrites=[];entries=[]
for rel,p in sorted(chosen.items()):
 target=DEST/rel;target.parent.mkdir(parents=True,exist_ok=True)
 original=p.read_bytes();changes={}
 if rel in texts:
  text,changes=redact(texts[rel])
  # Resolve the two report-embedded screenshots without changing source documents.
  for dep in dependencies:
   if dep['from']==rel:
    absolute=(ROOT/dep['resource']).as_posix()
    relative=os.path.relpath(DEST/dep['resource'],target.parent).replace('\\','/')
    if absolute in text:
     text=text.replace(absolute,relative);changes['portable_image_link']=changes.get('portable_image_link',0)+1
  if rel=='outputs/build-research-catalog-20261026.py':
   text=text.replace("ROOT = Path('E:/brief2great/sesame')\nOUT = ROOT / 'outputs'","REPO = Path(__file__).resolve().parents[4]\nOUT = Path(__file__).resolve().parent")
   text=text.replace("ROOT/'sesame/plugins/","REPO/'plugins/")
   changes['portable_generator_paths']=1
  if rel=='outputs/verify-research-catalog-20261026.py':
   text=text.replace("out=Path('E:/brief2great/sesame/outputs')","out=Path(__file__).resolve().parent")
   changes['portable_verifier_paths']=1
  target.write_text(text,encoding='utf-8-sig' if p.suffix.lower()=='.csv' else 'utf-8')
 elif rel in pdf_text:
  vals=[v for v in sensitive_values if v in pdf_text[rel]]
  if vals:
   with fitz.open(p) as doc:
    hits=0
    for page in doc:
     for val in vals:
      for rect in page.search_for(val):page.add_redact_annot(rect,text='REDACTED',fontsize=7);hits+=1
     page.apply_redactions()
    doc.set_metadata({})
    doc.save(target,garbage=4,deflate=True)
   changes['pdf_identifier_redaction']=hits
  else:shutil.copy2(p,target)
 else:shutil.copy2(p,target)
 data=target.read_bytes()
 entry={'source_path':rel,'archive_path':rel,'source_bytes':len(original),'bytes':len(data),
        'source_sha256':hashlib.sha256(original).hexdigest(),'sha256':hashlib.sha256(data).hexdigest()}
 if changes:entry['rewrites']=changes;rewrites.append({'path':rel,'categories':changes})
 entries.append(entry)

# Check archived text only; no values are ever emitted to logs or the manifest.
remaining=[]
for entry in entries:
 p=DEST/entry['archive_path']
 if p.suffix.lower() not in TEXT_EXT:continue
 t=p.read_text(encoding='utf-8-sig')
 if any(v in t for v in sensitive_values) or TOKEN.search(t) or PRIVATE_KEY.search(t):remaining.append(entry['archive_path'])
if remaining:raise RuntimeError('Sensitive-value scan failed for: '+', '.join(remaining))

# A narrowed selection must remove stale copies from this archive only. Never
# recurse-delete directories or touch original outputs/research files.
removed=[]
selected_paths={e['archive_path'] for e in entries}
for old in previous_entries:
 rel=old['archive_path']
 if rel in selected_paths:continue
 old_path=(DEST/rel).resolve()
 if not old_path.is_relative_to(DEST) or old_path==DEST:
  raise RuntimeError('Refusing archive cleanup outside the checked archive root')
 if old_path.is_file():
  old_path.unlink()
  removed.append({'path':rel,'reason':'no_longer_selected_copied_source_or_raw_material'})

manifest={'archive_date':'2026-10-26','source_roots':['outputs','research'],
 'selection':'Research/report/summary/design/prompt review documents and directly required companions; no runtime data/configuration or source snapshots.',
 'counts':{'files':len(entries),'bytes':sum(e['bytes'] for e in entries),'visited_files_after_pruning':scanned,
           'pruned_directories':len(pruned),'excluded_document_candidates':len(excluded),'rewritten_files':len(rewrites)},
 'privacy':{'credential_values_logged':False,'sensitive_identifier_groups_removed':len(sensitive_values),'remaining_text_matches':0,
            'raw_runtime_logs_and_configuration_excluded':True,'pdf_text_inspected':len(pdf_text)},
 'excluded_categories':dict(Counter(x['reason'] for x in excluded)),
 'pruned_directories':pruned,'excluded_documents':excluded,'dependencies':dependencies,
 'rewrites':rewrites,'removed_stale_archive_copies':removed,'files':entries}
(DEST/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

readme='''# 本地研究、报告与修改记录归档 · 2026-10-26

该归档与宿主、插件、网站的 `feat/local-20261026` 源码快照配套。保留本地实际研究报告、阶段分析、设计/提示词审阅、测试总结及报告必要配套；原文件留在本机。

## 从这里开始

- [研究报告体系：Trading Central、Autochartist 与 Sesame](outputs/研究报告体系-Trading-Central-Autochartist与Sesame-20261026.md)
- [同一研究的交互网页版](outputs/研究报告体系-Trading-Central-Autochartist与Sesame-20261026.html)
- [244个业务字段的CSV](outputs/研究报告体系-Trading-Central-Autochartist与Sesame-20261026-字段字典.csv)
- [发布-dev-本地差异与测试修改汇总](outputs/发布-dev-本地差异与测试修改汇总-20261021.md)
- [未推送改动与构建覆盖](outputs/未推送改动与构建覆盖-20261025.md)
- [默认插件提示词逐文件摘要](outputs/默认插件-提示词逐文件摘要-20261026.md)
- [宿主系统提示词中文版审阅稿](outputs/Sesame-宿主系统提示词-中文版审阅稿-20261026.md)
- [使用帮助时效核对](outputs/使用帮助时效核对-20261026.md)

## 文件组织

`outputs/` 保留原成果的相对目录；`research/` 保存独立研究笔记。历史报告按当时版本保存，日期和结果不改写成当前事实。GitHub直接阅读Markdown；HTML下载后在浏览器查看。

''' + f"本次归档 **{len(entries)} 个文件，{sum(e['bytes'] for e in entries)/1024/1024:.2f} MiB**。完整路径、文件大小、源/归档SHA-256及改写记录见 [manifest.json](manifest.json)。\n\n"
readme+='''运行数据库、账户配置/密钥、原始会话/界面日志、浏览器与依赖缓存、安装包、构建快照和第三方源码副本不纳入公共仓库。文档中的具体账户/订单等标识与本机用户配置路径已在归档副本中替换；研究或测试结论保持原意。

部分历史文档保留 `E:/...` 的源码行号与证据链接，它们是原开发机定位信息，不能在GitHub直接打开；相对报告链接及本次研究的旁路核对笔记保留。已收录报告所引用的本地图片/脚本；不自动上传未引用的原始截图或运行数据。

## 复现本次报告

`outputs/build-research-catalog-20261026.py` 与 `verify-research-catalog-20261026.py` 使用归档相对路径；报告生成依赖仓库内现有reports主题/模板，Python需要markdown、BeautifulSoup。渲染检查另需Playwright和本机Edge。脚本不会调用模型、行情或交易。

`archive_documents.py --workspace-root <原本地工作区>` 可按相同筛选/脱敏规则重新建立归档；它不改原文件，不执行Git提交或推送。归档是一次快照，后续重建前应重新审阅新增文档。

## 分类索引

'''
groups=defaultdict(list)
for e in entries:
 rel=e['archive_path'];parts=Path(rel).parts
 group='顶层研究与汇总' if len(parts)==2 else parts[1]
 groups[group].append(rel)
for group,rels in sorted(groups.items(),key=lambda x:(x[0]!='顶层研究与汇总',x[0])):
 readme+=f'\n### {group} · {len(rels)}\n\n'
 for rel in rels:
  label=Path(rel).name
  readme+=f'- [{label}](<{rel}>)\n'
(DEST/'README.md').write_text(readme,encoding='utf-8')
print(json.dumps({'counts':manifest['counts'],'privacy':manifest['privacy'],'rewrites':rewrites},ensure_ascii=False,indent=2))
