# Sources, license and scope

Accessed 2026-10-10. The Sesame scripts, examples and instructions in this package are original MIT work. No upstream skill text, source code, dataset, book chapter or paper is bundled. Reference metadata does not relicense upstream work.

## Directory and open-source comparison

The existing QuantSkills catalog was inspected as a historical discovery index: 214 entries captured 2026-10-03, catalog SHA256 `760935a4d850669bc0a3d783039eb837e01b512d2fa60601e07dd3835c0fd4db`. It is not evidence that those projects were installed, executed or audited. This package does not claim a later 218-project snapshot.

The following primary repository metadata/README and license identities were checked; no GPL skills or framework implementation were copied:

- [quantskills/skill-factor-idea-generation](https://github.com/quantskills/skill-factor-idea-generation/tree/4fda44d27bc80efe60284da6b03bc56a2bf4e82f); [license](https://github.com/quantskills/skill-factor-idea-generation/blob/4fda44d27bc80efe60284da6b03bc56a2bf4e82f/LICENSE) `GPL-3.0`, Git license blob `f288702d2fa16d3cdf0035b15a9fcbc552cd88e7`.
- [quantskills/skill-walk-forward-validator](https://github.com/quantskills/skill-walk-forward-validator/tree/bfa1a166a622fbc84487ad37d46738aa9778b1d6); [license](https://github.com/quantskills/skill-walk-forward-validator/blob/bfa1a166a622fbc84487ad37d46738aa9778b1d6/LICENSE) `GPL-3.0`, Git license blob `f288702d2fa16d3cdf0035b15a9fcbc552cd88e7`.
- [quantskills/skill-backtest-assumption-check](https://github.com/quantskills/skill-backtest-assumption-check/tree/7430dbc0f36751def82e0e4f102066fba12362b7); [license](https://github.com/quantskills/skill-backtest-assumption-check/blob/7430dbc0f36751def82e0e4f102066fba12362b7/LICENSE) `GPL-3.0`, Git license blob `f288702d2fa16d3cdf0035b15a9fcbc552cd88e7`.
- [microsoft/qlib](https://github.com/microsoft/qlib/tree/54355232463878d2eebb91fe0ee5fa7fa1f5976c); [license](https://github.com/microsoft/qlib/blob/54355232463878d2eebb91fe0ee5fa7fa1f5976c/LICENSE) `MIT`, Git license blob `9e841e7a26e4eb057b24511e7b92d42b257a80e5`.
- [stefan-jansen/alphalens-reloaded](https://github.com/stefan-jansen/alphalens-reloaded/tree/f0a07c22d554e4b4036983cc80320b432714fe7e); [license](https://github.com/stefan-jansen/alphalens-reloaded/blob/f0a07c22d554e4b4036983cc80320b432714fe7e/LICENSE) `Apache-2.0`, Git license blob `99d6c89b3ff1b8d91a14d3167df1ed45dc0268f5`.

The skill repositories were considered for overlap (idea formation, validation and assumption auditing). Their specific procedures are not imported. General research hygiene and statistics are implemented independently. Qlib/Alpha158 and Alphalens remain optional external frameworks, not installed dependencies or hidden execution modes.

## Primary research and documentation

- Bailey and López de Prado, [The Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf), 2014. Relevant to selection bias and the additional inputs required for inference. DSR is deliberately not computed from incomplete trial evidence.
- Bailey, Borwein, López de Prado and Zhu, [The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf). Relevant to preserving the candidate return matrix and distinguishing an explicit chronological audit from CSCV. This package does not implement CSCV/PBO.
- [Qlib data documentation](https://qlib.readthedocs.io/en/latest/component/data.html) and [Qlib paper](https://arxiv.org/abs/2009.11189). Used to check data/feature/dataset separation and adjustment/PIT concerns; no Alpha158 implementation is included.
- [Kenneth French data-library construction notes](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/f-f_factors.html) and [data-library changes](https://mba.tuck.dartmouth.edu/pages/Faculty/ken.french/data_library.html). Reference for precise universe/formation/data-revision descriptions, not a license to redistribute market data. No Fama–French series or factor model is imported.
- [Alphalens documentation](https://alphalens.ml4trading.io/notebooks/overview.html). Comparison of factor diagnostics; our small CLI uses its own rank/tie/cost implementation and is not equivalent to an Alphalens tear sheet.
- [Backtrader Cerebro documentation](https://www.backtrader.com/docu/cerebro/). A possible independently selected real engine; this package neither vendors nor executes Cerebro.

## Execution and evidence

Node.js 22+ built-ins only. No shell subprocess, network access, dependency installation, arbitrary expression evaluation or broker API exists in the resource CLI. Files execute with the current user’s permissions; no OS sandbox is claimed. JSON inputs and outputs are finite, source/dataset/plan bytes are hashed, and the demo is explicitly fictional. The CLI can check supplied declarations but cannot establish external vendor history, detect hidden research, certify an untouched holdout, or guarantee returns.

The factor package and strategy workflow are separate choices. Named methods/models are not silently loaded together. The scripts introduce no SVL operators or host interfaces.
