"""Group geo-blend: each group = mean of log-probs over its runs; final = weighted mean of group logs.
uv run --project core-ai python final_blend.py --name BLEND_best_now \
   --group 0.5:mistral7b_lora_v2 --group 0.5:mmbert_base_v1,mmbert_s2,... [--ref submissions/X.csv] [--tune-nested]
Group spec WEIGHT:run1,run2,... ; runs with <5 complete folds are rejected. Weights are normalised.
Writes core-ai/submissions/<name>.csv, prints honest OOF (fixed recipe) and, with --tune-nested,
nested-CV OOF of a Mistral-weight grid search."""
import argparse, sys
from pathlib import Path
import numpy as np, pandas as pd
R=Path('/Users/mac/RMIT_HACKATHON_2026/core-ai'); LAB=['BENIGN','JAILBREAK','PROMPT_INJECTION']
ap=argparse.ArgumentParser(); ap.add_argument('--name',required=True); ap.add_argument('--group',action='append',required=True)
ap.add_argument('--ref'); ap.add_argument('--tune-nested',action='store_true'); a=ap.parse_args()
tr=pd.read_csv(R/'data/raw/train.csv'); te=pd.read_csv(R/'data/raw/test.csv'); ss=pd.read_csv(R/'data/raw/sample_submission.csv')
fold=tr.id.map(pd.read_csv(R/'data/processed/folds.csv').set_index('id')['fold']).values
y=tr.label.map({l:i for i,l in enumerate(LAB)}).values; pos=pd.Series(np.arange(len(tr)),index=tr.id)
lg=lambda p:np.log(np.clip(p,0,1)+1e-9)
def f1(y,p):
    cm=np.bincount(y*3+p,minlength=9).reshape(3,3);tp=np.diag(cm);d=cm.sum(0)+cm.sum(1);return float(np.mean(2*tp/np.maximum(d,1)))
def load(run):
    oof=np.full((len(tr),3),np.nan);ts=[]
    for k in range(5):
        f=R/'outputs'/run/f'fold{k}'
        assert (f/'test_probs.npy').exists() and (f/'oof.csv').exists(),f'{run}: fold{k} missing'
        assert (np.load(f/'test_ids.npy',allow_pickle=True)==te.id.values).all(),f'{run}: test id order'
        o=pd.read_csv(f/'oof.csv'); oof[pos[o.id].values]=o[['p_BENIGN','p_JAILBREAK','p_PROMPT_INJECTION']].values
        ts.append(lg(np.load(f/'test_probs.npy')))
    assert not np.isnan(oof).any(),f'{run}: OOF incomplete'
    return lg(oof),np.mean(ts,0)
W=[];GO=[];GT=[]
for g in a.group:
    w,runs=g.split(':'); runs=runs.split(','); L=[load(r) for r in runs]
    W.append(float(w)); GO.append(np.mean([l[0] for l in L],0)); GT.append(np.mean([l[1] for l in L],0)); print(f'group w={w}: {len(runs)} runs, OOF F1 {f1(y,GO[-1].argmax(1)):.4f}')
W=np.array(W)/sum(W); bo=sum(w*g for w,g in zip(W,GO)); bt=sum(w*g for w,g in zip(W,GT))
print(f'fixed-recipe OOF macro-F1 {f1(y,bo.argmax(1)):.4f}; per-fold',[round(f1(y[fold==k],bo.argmax(1)[fold==k]),4) for k in range(5)])
if a.tune_nested and len(GO)==2:
    grid=np.arange(0,1.001,.1);P={w:(w*GO[0]+(1-w)*GO[1]).argmax(1) for w in grid};pr=np.zeros(len(y),int);ch=[]
    for k in range(5):
        t=fold!=k;b=max(grid,key=lambda w:f1(y[t],P[w][t]));ch.append(round(b,1));pr[~t]=P[b][~t]
    print(f'nested weight-search OOF {f1(y,pr):.4f}, chosen group0 weights per fold {ch}')
pred=bt.argmax(1); sub=pd.DataFrame({'id':te.id,'label':np.array(LAB)[pred]})
assert len(sub)==6000 and (sub.id.values==ss.id.values).all() and sub.label.isin(LAB).all()
out=R/'submissions'/f'{a.name}.csv'; sub.to_csv(out,index=False); print('wrote',out); print(sub.label.value_counts(normalize=True).round(4).to_dict())
if a.ref:
    r=pd.read_csv(a.ref).set_index('id').label.reindex(sub.id).values; print(f'agreement with {a.ref}: {(r==sub.label.values).mean():.4f} ({(r!=sub.label.values).sum()} diffs)')
