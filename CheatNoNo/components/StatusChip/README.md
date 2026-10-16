Status chips and strike pips show the state of an exam or a student, always with an icon and a word.

Student states: `cn-chip--active`, `--away`, `--warned`, `--locked`, `--submitted`, `--missing`. Test states: `--live`, `--draft`, `--ended`. `--flag` marks counts needing review. Strike pips (`cn-pips`) show used strikes in `amber`, switching to `cn-pips--danger` at strike 2 and above, and always sit next to a printed `n/3`.

The consumer provides the icon and label inside the chip. Do not rely on color alone and do not shorten the labels.