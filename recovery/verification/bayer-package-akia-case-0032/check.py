import ast,re,pathlib
p=pathlib.Path(__file__).parent
s=(p/'after/package-success-evidence.py').read_text()
pattern=next(n.value for n in ast.walk(ast.parse(s)) if isinstance(n,ast.Constant) and isinstance(n.value,bytes) and b'Bearer' in n.value)
assert re.search(pattern,b'AKIA' + b'A'*16,re.I)
assert not re.search(pattern,b'AkiA' + b'a'*16,re.I)
print('PASS: actual scanner rejects uppercase AWS-format marker; mixed-case collision not matched')
