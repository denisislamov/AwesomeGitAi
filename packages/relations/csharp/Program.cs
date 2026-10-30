using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using System.Text.Json;
using System.Text.Json.Serialization;
var options=new JsonSerializerOptions{PropertyNamingPolicy=JsonNamingPolicy.CamelCase};
try {
 var input=JsonSerializer.Deserialize<Input>(Console.In.ReadToEnd(),new JsonSerializerOptions{PropertyNameCaseInsensitive=true})!;
 var trees=input.Files.Select(f=>CSharpSyntaxTree.ParseText(f.Text,path:f.Path)).ToArray();
 var runtime=((string?)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")??"").Split(Path.PathSeparator).Where(File.Exists).Select(p=>MetadataReference.CreateFromFile(p));
 var comp=CSharpCompilation.Create("CapturedSources",trees,runtime,new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
 var symbols=new Dictionary<ISymbol,SymbolDto>(SymbolEqualityComparer.Default);
 foreach(var tree in trees){var model=comp.GetSemanticModel(tree);foreach(var n in tree.GetRoot().DescendantNodes()){
  ISymbol? s=n switch {BaseTypeDeclarationSyntax or MethodDeclarationSyntax or PropertyDeclarationSyntax or VariableDeclaratorSyntax or ParameterSyntax or EventDeclarationSyntax or ConstructorDeclarationSyntax => model.GetDeclaredSymbol(n), _=>null};
  if(s==null||s.IsImplicitlyDeclared||symbols.ContainsKey(s))continue;
  var l=s.Locations.FirstOrDefault(l=>l.IsInSource);if(l==null)continue;var p=l.GetLineSpan();symbols[s]=new($"{p.Path}:{p.StartLinePosition.Line+1}:{p.StartLinePosition.Character+1}",s.Name,s.Kind.ToString(),p.Path,p.StartLinePosition.Line+1,p.StartLinePosition.Character+1,[]);
 }}
 void Add(ISymbol? s,Location loc,string kind){if(s==null||!symbols.TryGetValue(s.OriginalDefinition,out var dto))return;var p=loc.GetLineSpan();int line=p.StartLinePosition.Line+1,col=p.StartLinePosition.Character+1;if(dto.Path==p.Path&&dto.Line==line&&dto.Column==col)return;var snippet=loc.SourceTree!.GetText().Lines[line-1].ToString().Trim();var r=new RefDto(p.Path,line,col,kind,snippet[..Math.Min(240,snippet.Length)]);if(!dto.References.Contains(r))dto.References.Add(r);}
 foreach(var tree in trees){var model=comp.GetSemanticModel(tree);foreach(var n in tree.GetRoot().DescendantNodes()){
  if(n is SimpleNameSyntax name){var s=model.GetSymbolInfo(name).Symbol;SyntaxNode e=name;if(name.Parent is MemberAccessExpressionSyntax ma&&ma.Name==name)e=ma;var kind="Read";
   if(e.Parent is InvocationExpressionSyntax call&&call.Expression==e){s=model.GetSymbolInfo(call).Symbol;kind="Call";}
   else if(e.Parent is AssignmentExpressionSyntax a&&a.Left==e)kind=a.IsKind(SyntaxKind.SimpleAssignmentExpression)?"Write":"ReadWrite";
   else if(e.Parent is PrefixUnaryExpressionSyntax pre&&(pre.IsKind(SyntaxKind.PreIncrementExpression)||pre.IsKind(SyntaxKind.PreDecrementExpression))||e.Parent is PostfixUnaryExpressionSyntax post&&(post.IsKind(SyntaxKind.PostIncrementExpression)||post.IsKind(SyntaxKind.PostDecrementExpression)))kind="ReadWrite";
   else if(s is ITypeSymbol type)kind=name.Ancestors().Any(x=>x is BaseTypeSyntax)?(type.TypeKind==TypeKind.Interface?"Implementation":"Inheritance"):"Type";
   Add(s,name.GetLocation(),kind);
  }
  if(n is MethodDeclarationSyntax method&&model.GetDeclaredSymbol(method) is IMethodSymbol m){Add(m.OverriddenMethod,method.Identifier.GetLocation(),"Override");foreach(var i in m.ContainingType.AllInterfaces.SelectMany(i=>i.GetMembers()))if(SymbolEqualityComparer.Default.Equals(m.ContainingType.FindImplementationForInterfaceMember(i),m))Add(i,method.Identifier.GetLocation(),"Implementation");}
 }}
 Console.WriteLine(JsonSerializer.Serialize(new {adapter="Roslyn "+typeof(CSharpCompilation).Assembly.GetName().Version,status="Partial",message="Captured files only; no project build configuration, generators or external dependencies. Unresolved references are unknown.",symbols=symbols.Values},options));
}catch(Exception e){Console.WriteLine(JsonSerializer.Serialize(new {adapter="Roslyn "+typeof(CSharpCompilation).Assembly.GetName().Version,status="Unavailable",message="Analysis failed: "+e.Message,symbols=Array.Empty<object>()},options));}
record Input(Source[] Files);record Source(string Path,string Text);
record SymbolDto(string Id,string Name,string Kind,string Path,int Line,int Column,List<RefDto> References);
record RefDto(string Path,int Line,int Column,string Kind,string Snippet);
