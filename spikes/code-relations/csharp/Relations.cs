using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
public record RelationReport(string[] Calls,int Overrides,int Implementations,int Reads,int Writes);
public static class Relations {
 public static RelationReport Analyze(SemanticModel model,SyntaxNode root) {
  var calls=root.DescendantNodes().OfType<InvocationExpressionSyntax>().Select(n=>model.GetSymbolInfo(n).Symbol?.ToDisplayString()??"Unknown").ToArray();
  var methods=root.DescendantNodes().OfType<MethodDeclarationSyntax>().Select(n=>model.GetDeclaredSymbol(n)).OfType<IMethodSymbol>().ToArray();
  var overrides=methods.Count(m=>m.OverriddenMethod!=null);
  var implementations=methods.Count(m=>m.ContainingType.AllInterfaces.SelectMany(i=>i.GetMembers()).Any(i=>SymbolEqualityComparer.Default.Equals(m.ContainingType.FindImplementationForInterfaceMember(i),m)));
  int reads=0,writes=0;
  foreach(var name in root.DescendantNodes().OfType<IdentifierNameSyntax>()) {
   if(model.GetSymbolInfo(name).Symbol is not IFieldSymbol)continue;
   if(name.Parent is AssignmentExpressionSyntax assignment&&assignment.Left==name)writes++;
   else reads++;
  }
  return new(calls,overrides,implementations,reads,writes);
 }
}
