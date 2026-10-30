"""Jedi analyzes an isolated copy of captured text; analyzed code is never run."""
import ast
import json
import sys
import tempfile
from pathlib import Path
try:
    import jedi
    jedi.settings.auto_import_modules = []
    data = json.load(sys.stdin)
    symbols = []
    with tempfile.TemporaryDirectory(prefix='agai-relations-') as root:
        jedi.settings.cache_directory = str(Path(root) / '.cache')
        sources = {}
        kinds = {}
        for file in data['files']:
            path = file['path']
            if Path(path).is_absolute() or '..' in Path(path).parts:
                raise ValueError('Invalid captured source path')
            target = Path(root) / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(file['text'], encoding='utf8')
            sources[str(target)] = (path, file['text'].splitlines())
            try:
                tree = ast.parse(file['text'])
                def key(node):
                    lines = sources[str(target)][1]
                    col = len(lines[node.lineno-1].encode('utf8')[:node.col_offset].decode('utf8'))
                    if isinstance(node, ast.Attribute):
                        col = len(lines[node.end_lineno-1].encode('utf8')[:node.end_col_offset].decode('utf8')) - len(node.attr)
                    return str(target), node.lineno, col
                for node in ast.walk(tree):
                    if isinstance(node, (ast.Name, ast.Attribute)):
                        kinds[key(node)] = 'Write' if isinstance(node.ctx, ast.Store) else 'Read'
                for node in ast.walk(tree):
                    expr = node.target if isinstance(node, ast.AugAssign) else node.func if isinstance(node, ast.Call) else None
                    if isinstance(expr, (ast.Name, ast.Attribute)):
                        kinds[key(expr)] = 'ReadWrite' if isinstance(node, ast.AugAssign) else 'Call'
                    if isinstance(node, ast.ClassDef):
                        for base in node.bases:
                            if isinstance(base, (ast.Name, ast.Attribute)):
                                kinds[key(base)] = 'Inheritance'
            except SyntaxError:
                pass
        project = jedi.Project(root, sys_path=[root], smart_sys_path=False, load_unsafe_extensions=False)
        consumed = set()
        for absolute, (path, lines) in sources.items():
            script = jedi.Script(code='\n'.join(lines), path=absolute, project=project)
            for definition in script.get_names(all_scopes=True, definitions=True, references=False):
                canonical = definition.goto(follow_imports=True)
                if canonical and all(str(d.module_path) != absolute or d.line != definition.line or d.column != definition.column for d in canonical):
                    continue
                pos = (absolute, definition.line, definition.column)
                if pos in consumed:
                    continue
                refs = script.get_references(definition.line, definition.column, scope='project', include_builtins=False)
                refs = [r for r in refs if str(r.module_path) in sources]
                consumed.update((str(r.module_path), r.line, r.column) for r in refs if r.is_definition())
                def location(ap, line, col):
                    p, ls = sources[ap]
                    return dict(path=p, line=line, column=len(ls[line-1][:col].encode('utf-16-le')) // 2 + 1)
                loc = location(*pos)
                symbols.append(dict(id=f'{path}:{loc["line"]}:{loc["column"]}', name=definition.name, kind=definition.type, **loc, references=[dict(**location(str(r.module_path),r.line,r.column), kind=kinds.get((str(r.module_path),r.line,r.column),'Reference'), snippet=sources[str(r.module_path)][1][r.line-1].strip()[:240]) for r in refs if (str(r.module_path),r.line,r.column)!=pos]))
    print(json.dumps(dict(adapter=f'Jedi {jedi.__version__}', status='Partial', message='Captured files only; dynamic dispatch, overrides, interface implementations and external dependencies may be unresolved. No project configuration is loaded.', symbols=symbols)))
except Exception as error:
    print(json.dumps(dict(adapter='Jedi', status='Unavailable', message=f'Analysis unavailable: {error}', symbols=[])))
