import json,re
env={}
class Parser:
 def __init__(self,s,i=0):self.s=s;self.i=i
 def ws(self):
  while self.i<len(self.s) and self.s[self.i].isspace():self.i+=1
 def take(self,t):
  self.ws()
  if self.s.startswith(t,self.i):self.i+=len(t);return True
  return False
 def string(self):
  assert self.take("E'");out=''
  while True:
   c=self.s[self.i];self.i+=1
   if c=="'":
    if self.s[self.i:self.i+1]=="'":out+="'";self.i+=1
    else:return out
   elif c=='\\':out+=self.s[self.i];self.i+=1
   else:out+=c
 def atom(self):
  self.ws()
  if self.s.startswith("E'",self.i):
   v=self.string();return json.loads(v) if self.take('::jsonb') else v
  if self.take('('):
   v=self.expr();assert self.take(')');return v
  for f in ['jsonb_build_object','jsonb_build_array']:
   if self.take(f):
    assert self.take('(');a=[]
    if not self.take(')'):
     while True:
      a.append(self.expr())
      if self.take(')'):break
      assert self.take(',')
    if f=='jsonb_build_array':return a
    assert len(a)%2==0;return dict(zip(a[::2],a[1::2]))
  m=re.match(r'atomic_json_\d+',self.s[self.i:]);assert m,self.s[self.i:self.i+80];self.i+=len(m[0]);return env[m[0]]
 def expr(self):
  v=self.atom()
  while self.take('||'):
   b=self.atom()
   if isinstance(v,dict) and isinstance(b,dict):v={**v,**b}
   elif isinstance(v,list) and isinstance(b,list):v=v+b
   else:raise AssertionError('unexpected concat')
  return v
for m in re.finditer(r'(atomic_json_\d+|source_result_data) jsonb := ',sql):
 p=Parser(sql,m.end());env[m[1]]=p.expr();assert p.take(';')

