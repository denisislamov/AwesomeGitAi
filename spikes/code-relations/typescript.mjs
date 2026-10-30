import ts from 'typescript';
// Fixture-only, in-memory service: never loads a user's tsconfig, plugins or code.
export function analyze(code,position) {
 const path='/fixture.ts';
 const host={getScriptFileNames:()=>[path],getScriptVersion:()=> 'snapshot-1',getScriptSnapshot:name=>name===path?ts.ScriptSnapshot.fromString(code):undefined,getCurrentDirectory:()=> '/',getCompilationSettings:()=>({noLib:true,target:ts.ScriptTarget.ES2022}),getDefaultLibFileName:()=>'',fileExists:name=>name===path,readFile:name=>name===path?code:undefined};
 const service=ts.createLanguageService(host);
 try {return {version:ts.version,references:service.getReferencesAtPosition(path,position)??[]};}
 finally{service.dispose();}
}
