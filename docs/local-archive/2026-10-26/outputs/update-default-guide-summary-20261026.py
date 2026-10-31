import json
import re
from pathlib import Path

root = Path('E:/brief2great/sesame')
packages = root / 'sesame/plugins/api-v1/packages'
out = root / 'outputs'
summaries = {
    'orchestration/prompt.md': '定义研究协作职责、主子 Agent 分工与交付原则；编排工具由宿主提供，知识指南指导真实调用；默认流程不合适时主动定制，保留最大努力、轻量研究、授权及长期偏好规则。',
    'orchestration/skills/coordinate-research/SKILL.md': '按目标选择直接委派、定制已有业务工作流或自定义协作；给出宿主 Agent/Run 工具与具体步骤，说明成员权限、知识、依赖、报告及完成通知。完整调用和三种工作流计划放参考中，协作图不代替实际调度。',
    'plugin-manager/prompt.md': '要求优先发现和使用适合的插件，区分信息、方法、流程与执行；分别核对安装、加载、挂载、配置和业务成功，保持真实回执与操作身份。管理已有插件和开发插件各有技能入口。',
    'plugin-manager/skills/manage-plugins/SKILL.md': '发现、读取、会话加载、安装更新和实际验收；区分 mounted/discoverable/disabled、配置依赖与运行失败。明确当前可调用工具及摘要字段，管理完成后继续原任务，不把安装检查当业务通过。',
    'plugin-manager/skills/develop-plugins/SKILL.md': '确定职责与最小接口，生成并实现草稿，声明配置、权限、依赖和知识，再运行业务测试、安装并验收；保留全部显式声明与测试资料原则，区分 prompt、skill、reference。',
    'data-access/prompt.md': '负责提供可复用的真实输入；优先共享适用证据并主动寻找来源、缓存及数据能力，保留来源、时间、单位和精度。不把取数当研究结论，不把历史读取当实时显示，不伪造缺失数据或执行证据。',
    'data-access/skills/market-discovery/SKILL.md': '复用有效来源与品种引用，按实际缺口发现全来源、市场来源或适配器专有能力；根据显示、历史研究或一般查询选择入口，核验真实输出。完整时间、分页、缓存和错误处理规则按需读取。',
    'data-access/skills/analyze-data/SKILL.md': '找到登记输入或固定 DataRef，读入独立计算目录，编写并执行分析，再用真实 executionId 和冻结输入输出登记可复查成果，交给方法、工作流或报告；详细证据参数放参考。',
    'reports/prompt.md': '用统一模板交付真实报告，保留市场表达、证据、命名与分类、主题语义色、决策树和导出原则；交付前核对统一视觉及当前修订渲染，正文不赘述设计和检查过程。',
    'reports/skills/report-design/SKILL.md': '选择统一模板与现成图表，按需查询组件参数；发布前核对模板、主题、默认组件和实际预览，对当前 ref 运行渲染检查，修正后发布新修订再验收。保留用户局部自定义及原生回测无需 SVL。',
    'user-guide/prompt.md': '定义产品上手与操作帮助职责；问用法时解释入口和结果，要求代做时使用业务能力。核验真实状态，区分默认装配与按需读取；协作、管理开发插件由各自指南负责。',
    'user-guide/skills/sesame-user-guide/SKILL.md': '按用户问题选择七篇参考，提供必要步骤与可观察结果。同步开屏和后台运行、当前目录标签、附件与聊天进度、Ultra、设置和研究排障；详细交互按需读取，Agent/Run 与插件管理参数不在这里重复维护。',
}

inventory = {}
counts = {}
for directory in sorted(packages.iterdir()):
    manifest = json.loads((directory / 'plugin.json').read_text(encoding='utf-8'))
    if manifest.get('default_state') != 'mounted':
        continue
    declared = json.loads((directory / 'capabilities.json').read_text(encoding='utf-8'))
    entries = []
    for resource in declared['knowledge']:
        if resource['kind'] not in ['prompt', 'skill']:
            continue
        path = directory / resource['path']
        chars = len(path.read_text(encoding='utf-8').encode('utf-16-le')) // 2
        counts[path.as_posix()] = chars
        entries.append({'path': resource['path'], 'kind': resource['kind'], 'characters': chars})
    inventory[manifest['id']] = {'version': manifest['version'], 'files': entries, 'characters': sum(x['characters'] for x in entries)}
total_files = sum(len(x['files']) for x in inventory.values())
total_chars = sum(x['characters'] for x in inventory.values())
skills = sum(x['kind'] == 'skill' for item in inventory.values() for x in item['files'])
guide_path = (packages / 'plugin-manager/skills/manage-plugins/SKILL.md').as_posix()
key_for = lambda path: str(Path(path).relative_to(packages)).replace('\\', '/')

path = out / '默认插件-提示词逐文件摘要-20261026.md'
text = path.read_text(encoding='utf-8')
text = re.sub(r'\b21 份', f'{total_files} 份', text)
text = re.sub(r'\b12 个', f'{skills} 个', text)
text = re.sub(r'合计约 [\d,]+ 个字符', f'合计约 {total_chars:,} 个字符', text)
lines = []
for line in text.splitlines():
    match = re.match(r'\| (sesame/[\w-]+) \|', line)
    if match and match[1] in inventory:
        item = inventory[match[1]]
        line = f"| {match[1]} | {item['version']} | {len(item['files'])} | {item['characters']:,} |"
    match = re.match(r'(\| \[.*?\]\(([^)]+)\) \| )[\d,]+ \| (.*) \|$', line)
    if match and match[2] in counts:
        desc = summaries.get(key_for(match[2]), match[3])
        line = f'{match[1]}{counts[match[2]]:,} | {desc} |'
        if 'plugin-manager/skills/develop-plugins/SKILL.md)' in line and f']({guide_path})' not in text:
            lines.append(f'| [skills/manage-plugins/SKILL.md]({guide_path}) | {counts[guide_path]:,} | {summaries[key_for(guide_path)]} |')
    lines.append(line)
path.write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')

path = out / 'Sesame-Agent-系统提示词目录-20261026.md'
text = path.read_text(encoding='utf-8')
text = text.replace('7 篇插件总提示和 11 篇技能入口', f'9 篇插件总提示和 {skills} 篇技能入口').replace('原提示词未改动。', '宿主总提示词未改动，插件指南已按职责整理。')
text = text.replace('12 个 SKILL.md', f'{skills} 个 SKILL.md').replace('11 篇技能入口', f'{skills} 篇技能入口')
lines = []
for line in text.splitlines():
    match = re.match(r'(\| \[.*?\]\(([^)]+)\) \| )(.*)', line)
    if match and match[2] in counts:
        key = key_for(match[2])
        if key in summaries:
            columns = match[3].split(' | ')
            columns[0] = summaries[key]
            if key == 'plugin-manager/prompt.md':
                columns[1] = 'manage-plugins、develop-plugins |'
            line = match[1] + ' | '.join(columns)
            if not line.endswith('|'):
                line += ' |'
        if key == 'plugin-manager/skills/develop-plugins/SKILL.md' and f']({guide_path})' not in text:
            lines.append(f'| [manage-plugins]({guide_path}) | {summaries[key_for(guide_path)]} |')
    if line.startswith('reports 3.3.1 已统一'):
        line = '本轮继续整理 orchestration 3.2.1、plugin-manager 3.1.3、data-access 3.0.3、reports 3.3.2：编排增加工具与定制方法，插件管理分为管理与开发两项技能，数据访问按真实来源和固定证据流程组织，报告简化视觉长文并明确交付验收。宿主总提示词和装配逻辑未改动；本目录描述最新源码，当前应用尚未替换。'
    lines.append(line)
path.write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')
(out / '默认插件-整理后提示词计数-20261026.json').write_text(json.dumps({'plugins': inventory, 'files': total_files, 'skills': skills, 'characters': total_chars}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'plugins': len(inventory), 'files': total_files, 'skills': skills, 'characters': total_chars}, ensure_ascii=False))
