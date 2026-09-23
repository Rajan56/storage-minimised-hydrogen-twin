import json
src=open('animation_src.html').read()
out=src.replace('/*__LINES__*/',json.dumps(json.load(open('lines.json')))).replace('/*__DATA__*/',open('data.json').read())
open('animation.html','w').write(out); print('ok')
