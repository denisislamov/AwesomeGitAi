import {EditorState, type Extension} from '@codemirror/state';
import {EditorView, lineNumbers, highlightActiveLineGutter} from '@codemirror/view';
import {syntaxHighlighting, HighlightStyle} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import {javascript} from '@codemirror/lang-javascript';
import {python} from '@codemirror/lang-python';
import {csharp} from '@replit/codemirror-lang-csharp';
export const theme = EditorView.theme({
 '&':{backgroundColor:'#1d2021',color:'#ebdbb2',fontSize:'15px'},
 '.cm-content':{fontFamily:'Monaco, monospace',padding:'16px 0'},
 '.cm-gutters':{backgroundColor:'#282828',color:'#bdae93',border:'none'},
 '.cm-line':{padding:'0 12px'},
 '&.cm-focused .cm-selectionBackground, .cm-selectionBackground':{backgroundColor:'#504945'},
 '.cm-cursor':{borderLeftColor:'#fabd2f'},
}, {dark:true});
const highlight=HighlightStyle.define([
 {tag:tags.keyword,color:'#fe8019'},{tag:tags.typeName,color:'#fabd2f'},
 {tag:tags.string,color:'#b8bb26'},{tag:tags.number,color:'#d3869b'},
 {tag:tags.comment,color:'#bdae93'},{tag:tags.function(tags.variableName),color:'#b8bb26'},
]);
export function extensions(language:string):Extension[] {
 const parser=language==='csharp'?csharp():language==='python'?python():javascript({typescript:true});
 return [EditorState.readOnly.of(true),EditorView.editable.of(false),lineNumbers(),highlightActiveLineGutter(),parser,theme,syntaxHighlighting(highlight),EditorView.lineWrapping];
}
export function makeState(text:string,language:string):EditorState {return EditorState.create({doc:text,extensions:extensions(language)});}
export function needsLargeFileView(text:string):boolean {return new TextEncoder().encode(text).byteLength>2*1024*1024;}
