using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
var source = """
interface IRunner { void Run(int n); }
class Base { public virtual void Run(int n) {} }
class Runner : Base, IRunner {
 public int Count;
 public override void Run(int n) { Count = n; }
 public void Run(string text) {}
 public int Read() { return Count; }
}
class Client { void Tick(Runner runner) { runner.Run(1); runner.Run("x"); } }
""";
var tree=CSharpSyntaxTree.ParseText(source);
var references=((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!).Split(Path.PathSeparator).Select(p=>MetadataReference.CreateFromFile(p));
var compilation=CSharpCompilation.Create("fixture",[tree],references,new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
if(compilation.GetDiagnostics().Any(d=>d.Severity==DiagnosticSeverity.Error)) throw new Exception("Invalid fixture");
var model=compilation.GetSemanticModel(tree);
var relations=Relations.Analyze(model, tree.GetRoot());
if(relations.Calls.Distinct().Count()!=2 || !relations.Calls.Any(c=>c.Contains("string")) || !relations.Calls.Any(c=>c.Contains("int"))) throw new Exception("Overloads must resolve separately");
if(relations.Overrides!=1 || relations.Implementations!=1 || relations.Reads!=1 || relations.Writes!=1) throw new Exception("Relationships or access kinds missing");
Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new {adapter="Roslyn",version=typeof(SemanticModel).Assembly.GetName().Version!.ToString(),relations}));
