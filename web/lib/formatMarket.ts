// Raw market_key values like 'PLAYER_POINTS_REBOUNDS_ASSISTS_ALTERNATE' are
// too long for table cells and grade rows. Map common NBA markets to short
// labels; strip the _ALTERNATE suffix and surface it as a separate `alt` flag
// the UI can render as a small chip.

const MARKET_LABELS: Record<string, string> = {
  PLAYER_POINTS:                  'PTS',
  PLAYER_REBOUNDS:                'REB',
  PLAYER_ASSISTS:                 'AST',
  PLAYER_THREES:                  '3PM',
  PLAYER_THREES_MADE:             '3PM',
  PLAYER_BLOCKS:                  'BLK',
  PLAYER_STEALS:                  'STL',
  PLAYER_TURNOVERS:               'TOV',
  PLAYER_POINTS_REBOUNDS:         'PTS+REB',
  PLAYER_POINTS_ASSISTS:          'PTS+AST',
  PLAYER_REBOUNDS_ASSISTS:        'REB+AST',
  PLAYER_POINTS_REBOUNDS_ASSISTS: 'PRA',
  PLAYER_BLOCKS_STEALS:           'BLK+STL',
  PLAYER_DOUBLE_DOUBLE:           '2x2',
  PLAYER_TRIPLE_DOUBLE:           '3x3',
  // MLB-specific (added so the formatter is useful cross-sport)
  BATTER_HITS:                    'H',
  BATTER_HOME_RUNS:               'HR',
  BATTER_TOTAL_BASES:             'TB',
  BATTER_RBIS:                    'RBI',
  BATTER_RUNS:                    'R',
  BATTER_STOLEN_BASES:            'SB',
  PITCHER_STRIKEOUTS:             'K',
  PITCHER_OUTS:                   'OUTS',
  PITCHER_EARNED_RUNS:            'ER',
  PITCHER_HITS_ALLOWED:           'H A',
  PITCHER_WALKS:                  'BB',
};

export interface FormattedMarket {
  label: string;
  alt: boolean;
}

export function formatMarket(raw: string): FormattedMarket {
  // Normalize: API returns lowercase ('player_points_alternate'); LABELS keys
  // are uppercase. Uppercase first, then strip _ALTERNATE, then look up.
  const upper    = raw.toUpperCase();
  const stripped = upper.replace(/_ALTERNATE$/, '');
  const alt      = upper !== stripped;
  const label    = MARKET_LABELS[stripped]
    ?? stripped.replace(/^PLAYER_|^BATTER_|^PITCHER_/, '').replace(/_/g, ' ');
  return { label, alt };
}
