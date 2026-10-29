import {describe,it,expect} from 'vitest';
import {EditorState} from '@codemirror/state';
import {syntaxTree} from '@codemirror/language';
import {makeState,needsLargeFileView} from './editor';
describe('read-only multilingual viewer',()=>{
 it.each([['csharp','public sealed class Demo { }'],['typescript','const x: number = 1;'],['python','def run():\n    return 1']])('parses %s and forbids edits',(lang,code)=>{
  const state=makeState(code,lang);expect(state.facet(EditorState.readOnly)).toBe(true);
  expect(syntaxTree(state).length).toBe(code.length);expect(syntaxTree(state).topNode.firstChild).not.toBeNull();
 });
 it('uses byte size rather than character count to protect the editor',()=>{
  expect(needsLargeFileView('a'.repeat(2*1024*1024))).toBe(false);
  expect(needsLargeFileView('a'.repeat(2*1024*1024+1))).toBe(true);
  expect(needsLargeFileView('я'.repeat(1024*1024+1))).toBe(true);
 });
});
