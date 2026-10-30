"""Fixture-only static analysis, never executes Python source or an interpreter."""
import jedi

def references(code,line,column):
    script=jedi.Script(code=code)
    refs=script.get_references(line=line,column=column,scope='file',include_builtins=False)
    return {'version':jedi.__version__,'completeness':'partial',
            'references':sorted([{'line':r.line,'definition':r.is_definition()} for r in refs],key=lambda r:(r['line'],r['definition']))}
