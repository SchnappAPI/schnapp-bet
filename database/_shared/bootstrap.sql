-- Generated 2026-05-05. Apply in order: common/odds schemas first, then sport schemas.

CREATE TABLE [common].[calibration_history] (
    [run_id] INT NOT NULL,
    [snapshot_date] DATE NOT NULL,
    [market_group] VARCHAR(20) NOT NULL,
    [n_train] INT,
    [n_holdout] INT,
    [candidate_score] FLOAT,
    [production_score] FLOAT,
    [weights_updated] BIT DEFAULT ((0)) NOT NULL,
    [model_version] VARCHAR(50),
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_calibration_history] PRIMARY KEY ([run_id])
);

CREATE TABLE [common].[daily_grades] (
    [grade_id] INT NOT NULL,
    [grade_date] DATE NOT NULL,
    [event_id] VARCHAR(50) NOT NULL,
    [game_id] VARCHAR(50),
    [player_id] BIGINT,
    [player_name] NVARCHAR(100) NOT NULL,
    [market_key] VARCHAR(100) NOT NULL,
    [bookmaker_key] VARCHAR(50) NOT NULL,
    [line_value] DECIMAL(6,1) NOT NULL,
    [hit_rate_60] FLOAT,
    [hit_rate_20] FLOAT,
    [sample_size_60] INT,
    [sample_size_20] INT,
    [weighted_hit_rate] FLOAT,
    [grade] FLOAT,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    [trend_grade] FLOAT,
    [momentum_grade] FLOAT,
    [pattern_grade] FLOAT,
    [matchup_grade] FLOAT,
    [regression_grade] FLOAT,
    [composite_grade] FLOAT,
    [hit_rate_opp] FLOAT,
    [sample_size_opp] INT,
    [over_price] INT,
    [outcome_name] VARCHAR(5) DEFAULT ('Over') NOT NULL,
    [outcome] VARCHAR(5),
    [opportunity_short_grade] FLOAT,
    [opportunity_long_grade] FLOAT,
    [opportunity_matchup_grade] FLOAT,
    [opportunity_streak_grade] FLOAT,
    [opportunity_volume_grade] FLOAT,
    [opportunity_expected_grade] FLOAT,
    [model_version] VARCHAR(50),
    [relevance_hit_rate] FLOAT,
    [effective_n] FLOAT,
    [role_minutes_current] FLOAT,
    [role_volatility] FLOAT,
    [model_prob] FLOAT,
    [implied_prob] FLOAT,
    [ev_pct] FLOAT,
    CONSTRAINT [PK_daily_grades] PRIMARY KEY ([grade_id])
);
CREATE UNIQUE INDEX [uq_daily_grades_v3] ON [common].[daily_grades] ([grade_date], [event_id], [player_id], [market_key], [bookmaker_key], [line_value], [outcome_name]);

CREATE TABLE [common].[daily_grades_archive] (
    [grade_id] INT NOT NULL,
    [grade_date] DATE NOT NULL,
    [event_id] VARCHAR(50) NOT NULL,
    [game_id] VARCHAR(15),
    [player_id] BIGINT,
    [player_name] NVARCHAR(100) NOT NULL,
    [market_key] VARCHAR(100) NOT NULL,
    [bookmaker_key] VARCHAR(50) NOT NULL,
    [line_value] DECIMAL(6,1) NOT NULL,
    [hit_rate_60] FLOAT,
    [hit_rate_20] FLOAT,
    [sample_size_60] INT,
    [sample_size_20] INT,
    [weighted_hit_rate] FLOAT,
    [grade] FLOAT,
    [created_at] DATETIME2 NOT NULL,
    [trend_grade] FLOAT,
    [momentum_grade] FLOAT,
    [pattern_grade] FLOAT,
    [matchup_grade] FLOAT,
    [regression_grade] FLOAT,
    [composite_grade] FLOAT,
    [hit_rate_opp] FLOAT,
    [sample_size_opp] INT,
    [over_price] INT,
    [outcome_name] VARCHAR(5) NOT NULL,
    [outcome] VARCHAR(5),
    [is_standard] BIT NOT NULL,
    [archived_at] DATETIME2,
    [opportunity_short_grade] FLOAT,
    [opportunity_long_grade] FLOAT,
    [opportunity_matchup_grade] FLOAT,
    [opportunity_streak_grade] FLOAT,
    [opportunity_volume_grade] FLOAT,
    [opportunity_expected_grade] FLOAT,
    [model_version] VARCHAR(50)
);

CREATE TABLE [common].[data_completeness_log] (
    [log_id] BIGINT NOT NULL,
    [table_name] VARCHAR(100) NOT NULL,
    [row_key] NVARCHAR(500) NOT NULL,
    [column_name] VARCHAR(100) NOT NULL,
    [first_detected_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    [last_attempt_at] DATETIME2,
    [attempt_count] INT DEFAULT ((0)) NOT NULL,
    [resolved_at] DATETIME2,
    [detected_retroactively] BIT DEFAULT ((0)) NOT NULL,
    [notes] NVARCHAR(MAX),
    CONSTRAINT [PK_data_completeness_log] PRIMARY KEY ([log_id])
);
CREATE INDEX [IX_completeness_retry_ready] ON [common].[data_completeness_log] ([last_attempt_at], [attempt_count]);
CREATE UNIQUE INDEX [UQ_completeness_log] ON [common].[data_completeness_log] ([table_name], [row_key], [column_name]);

CREATE TABLE [common].[demo_config] (
    [sport] VARCHAR(10) NOT NULL,
    [demo_date] DATE NOT NULL,
    [label] VARCHAR(100),
    CONSTRAINT [PK_demo_config] PRIMARY KEY ([sport])
);

CREATE TABLE [common].[dim_date] (
    [date_key] DATE NOT NULL,
    [calendar_year] SMALLINT NOT NULL,
    [calendar_month] TINYINT NOT NULL,
    [month_name] VARCHAR(9) NOT NULL,
    [calendar_day] TINYINT NOT NULL,
    [day_of_week] TINYINT NOT NULL,
    [day_name] VARCHAR(9) NOT NULL,
    [week_of_year] TINYINT NOT NULL,
    [quarter] TINYINT NOT NULL,
    [is_weekend] BIT NOT NULL,
    CONSTRAINT [PK_dim_date] PRIMARY KEY ([date_key])
);

CREATE TABLE [common].[feature_flags] (
    [flag_key] VARCHAR(100) NOT NULL,
    [enabled] BIT DEFAULT ((0)) NOT NULL,
    [updated_at] DATETIME2 DEFAULT (sysutcdatetime()) NOT NULL,
    CONSTRAINT [PK_feature_flags] PRIMARY KEY ([flag_key])
);

CREATE TABLE [common].[game_supplemental] (
    [supplemental_id] INT NOT NULL,
    [game_date] DATE NOT NULL,
    [game_id] VARCHAR(15) NOT NULL,
    [generated_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    [payload] NVARCHAR(MAX) NOT NULL,
    CONSTRAINT [PK_game_supplemental] PRIMARY KEY ([supplemental_id])
);
CREATE UNIQUE INDEX [uq_game_supplemental] ON [common].[game_supplemental] ([game_date], [game_id]);

CREATE TABLE [common].[grade_calibration] (
    [bucket_min] FLOAT NOT NULL,
    [bucket_max] FLOAT NOT NULL,
    [sample_size] INT NOT NULL,
    [empirical_hit_rate] FLOAT NOT NULL,
    [isotonic_hit_rate] FLOAT NOT NULL,
    [last_updated] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    [max_well_sampled_rate] FLOAT,
    CONSTRAINT [PK_grade_calibration] PRIMARY KEY ([bucket_min])
);

CREATE TABLE [common].[grade_calibration_history] (
    [snapshot_id] INT NOT NULL,
    [snapshot_date] DATE NOT NULL,
    [sport] VARCHAR(10) DEFAULT ('nba') NOT NULL,
    [bucket_min] FLOAT NOT NULL,
    [bucket_max] FLOAT NOT NULL,
    [sample_size] INT NOT NULL,
    [empirical_hit_rate] FLOAT NOT NULL,
    [isotonic_hit_rate] FLOAT NOT NULL,
    [max_well_sampled_rate] FLOAT,
    [window_days] INT NOT NULL,
    [model_version] VARCHAR(50),
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_grade_calibration_history] PRIMARY KEY ([snapshot_id])
);
CREATE INDEX [ix_calhist_sport_date] ON [common].[grade_calibration_history] ([sport], [snapshot_date]);

CREATE TABLE [common].[grade_weights] (
    [weight_id] INT NOT NULL,
    [market_group] VARCHAR(20) NOT NULL,
    [feature_name] VARCHAR(50) NOT NULL,
    [coefficient] FLOAT NOT NULL,
    [intercept] FLOAT NOT NULL,
    [holdout_score] FLOAT,
    [production_score] FLOAT,
    [effective_from] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    [is_active] BIT DEFAULT ((1)) NOT NULL,
    [model_version] VARCHAR(50) NOT NULL,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_grade_weights] PRIMARY KEY ([weight_id])
);
CREATE INDEX [ix_grade_weights_group_active] ON [common].[grade_weights] ([market_group], [is_active], [effective_from]);

CREATE TABLE [common].[ingest_quarantine] (
    [quarantine_id] BIGINT NOT NULL,
    [table_name] VARCHAR(100) NOT NULL,
    [row_key] NVARCHAR(500) NOT NULL,
    [row_payload] NVARCHAR(MAX) NOT NULL,
    [failed_invariant] VARCHAR(200) NOT NULL,
    [source_workflow] VARCHAR(100),
    [first_seen_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    [last_retry_at] DATETIME2,
    [retry_count] INT DEFAULT ((0)) NOT NULL,
    [resolved_at] DATETIME2,
    [resolution_notes] NVARCHAR(MAX),
    CONSTRAINT [PK_ingest_quarantine] PRIMARY KEY ([quarantine_id])
);
CREATE INDEX [IX_quarantine_retry_ready] ON [common].[ingest_quarantine] ([last_retry_at], [retry_count]);
CREATE INDEX [IX_quarantine_table_key_open] ON [common].[ingest_quarantine] ([table_name], [row_key]);

CREATE TABLE [common].[player_line_patterns] (
    [player_id] BIGINT NOT NULL,
    [market_key] VARCHAR(100) NOT NULL,
    [line_value] DECIMAL(6,1) NOT NULL,
    [n] INT NOT NULL,
    [hr_overall] FLOAT NOT NULL,
    [p_hit_after_hit] FLOAT,
    [p_hit_after_miss] FLOAT,
    [hit_momentum] FLOAT,
    [miss_momentum] FLOAT,
    [pattern_strength] FLOAT,
    [is_momentum_player] BIT DEFAULT ((0)) NOT NULL,
    [is_reversion_player] BIT DEFAULT ((0)) NOT NULL,
    [is_bouncy_player] BIT DEFAULT ((0)) NOT NULL,
    [last_updated] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_player_line_patterns] PRIMARY KEY ([player_id], [market_key], [line_value])
);

CREATE TABLE [common].[player_tier_lines] (
    [tier_id] INT NOT NULL,
    [grade_date] DATE NOT NULL,
    [game_id] VARCHAR(50),
    [player_id] BIGINT NOT NULL,
    [player_name] NVARCHAR(100) NOT NULL,
    [market_key] VARCHAR(100) NOT NULL,
    [composite_grade] FLOAT,
    [kde_window] INT,
    [blowout_dampened] BIT DEFAULT ((0)) NOT NULL,
    [safe_line] DECIMAL(6,1),
    [safe_prob] FLOAT,
    [value_line] DECIMAL(6,1),
    [value_prob] FLOAT,
    [highrisk_line] DECIMAL(6,1),
    [highrisk_prob] FLOAT,
    [highrisk_price] INT,
    [lotto_line] DECIMAL(6,1),
    [lotto_prob] FLOAT,
    [lotto_price] INT,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    [safe_hits_all] INT,
    [safe_games_all] INT,
    [safe_hits_20] INT,
    [safe_games_20] INT,
    [value_hits_all] INT,
    [value_games_all] INT,
    [value_hits_20] INT,
    [value_games_20] INT,
    [highrisk_hits_all] INT,
    [highrisk_games_all] INT,
    [highrisk_hits_20] INT,
    [highrisk_games_20] INT,
    [lotto_hits_all] INT,
    [lotto_games_all] INT,
    [lotto_hits_20] INT,
    [lotto_games_20] INT,
    [safe_price] INT,
    [value_price] INT,
    [recent_minutes_20] FLOAT,
    [recent_opportunity] FLOAT,
    [historical_opportunity] FLOAT,
    [safe_ev] FLOAT,
    [value_ev] FLOAT,
    [highrisk_ev] FLOAT,
    [lotto_ev] FLOAT,
    [highrisk_hit_avg_min] FLOAT,
    [highrisk_hit_avg_opp] FLOAT,
    [lotto_hit_avg_min] FLOAT,
    [lotto_hit_avg_opp] FLOAT,
    [model_version] VARCHAR(50),
    CONSTRAINT [PK_player_tier_lines] PRIMARY KEY ([tier_id])
);
CREATE UNIQUE INDEX [uq_player_tier_lines] ON [common].[player_tier_lines] ([grade_date], [game_id], [player_id], [market_key]);

CREATE TABLE [common].[prop_lines] (
    [line_id] INT NOT NULL,
    [grade_date] DATE NOT NULL,
    [player_id] INT NOT NULL,
    [player_name] NVARCHAR(100) NOT NULL,
    [prop_type] NVARCHAR(50) NOT NULL,
    [line_value] FLOAT NOT NULL,
    [active] BIT DEFAULT ((1)) NOT NULL,
    [created_at] DATETIME2 DEFAULT (getutcdate()),
    CONSTRAINT [PK_prop_lines] PRIMARY KEY ([line_id])
);
CREATE UNIQUE INDEX [uq_prop_line] ON [common].[prop_lines] ([grade_date], [player_id], [prop_type], [line_value]);

CREATE TABLE [common].[teams] (
    [team_id] INT NOT NULL,
    [sport_key] VARCHAR(30) NOT NULL,
    [league] VARCHAR(10) NOT NULL,
    [source_team_id] VARCHAR(20) NOT NULL,
    [team_name] VARCHAR(60) NOT NULL,
    [city] VARCHAR(60),
    [nickname] VARCHAR(40),
    [tricode] VARCHAR(5) NOT NULL,
    [conference] VARCHAR(20),
    [division] VARCHAR(30),
    [participant_id] VARCHAR(50),
    [pff_team_id] INT,
    [pff_team_abbr] VARCHAR(5),
    [nflreadpy_abbr] VARCHAR(5),
    [alt_abbr] VARCHAR(5),
    [primary_color] CHAR(7),
    [secondary_color] CHAR(7),
    [tertiary_color] CHAR(7),
    [dark_color_ref] CHAR(7),
    [light_color_ref] CHAR(7),
    [background_color_ref] CHAR(7),
    [foreground_color] CHAR(7),
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_teams] PRIMARY KEY ([team_id])
);
CREATE UNIQUE INDEX [uq_common_teams_src] ON [common].[teams] ([sport_key], [source_team_id]);

CREATE TABLE [common].[teams_backup] (
    [league] VARCHAR(10) NOT NULL,
    [team_id] BIGINT NOT NULL,
    [team_name] NVARCHAR(100) NOT NULL,
    [tricode] VARCHAR(10),
    [conference] VARCHAR(50),
    [team_index] INT,
    [sport_key] VARCHAR(50),
    [participant_id] VARCHAR(36),
    [created_at] DATETIME2
);

CREATE TABLE [common].[unmapped_entities] (
    [unmapped_id] BIGINT NOT NULL,
    [source_feed] VARCHAR(100) NOT NULL,
    [entity_type] VARCHAR(50) NOT NULL,
    [source_key] NVARCHAR(500) NOT NULL,
    [source_context] NVARCHAR(MAX),
    [first_seen_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    [last_seen_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    [seen_count] INT DEFAULT ((1)) NOT NULL,
    [candidate_match] NVARCHAR(500),
    [candidate_method] VARCHAR(50),
    [candidate_confidence] FLOAT,
    [resolved_mapping] NVARCHAR(500),
    [resolved_at] DATETIME2,
    [resolution_notes] NVARCHAR(MAX),
    [retry_count] INT DEFAULT ((0)) NOT NULL,
    CONSTRAINT [PK_unmapped_entities] PRIMARY KEY ([unmapped_id])
);
CREATE INDEX [IX_unmapped_unresolved] ON [common].[unmapped_entities] ([retry_count], [last_seen_at]);
CREATE UNIQUE INDEX [UQ_unmapped_entities] ON [common].[unmapped_entities] ([source_feed], [entity_type], [source_key]);

CREATE TABLE [common].[user_activations] (
    [id] INT NOT NULL,
    [code] VARCHAR(50) NOT NULL,
    [activated_at] DATETIME NOT NULL,
    CONSTRAINT [PK_user_activations] PRIMARY KEY ([id])
);

CREATE TABLE [common].[user_codes] (
    [code] NVARCHAR(50) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [active] BIT DEFAULT ((1)) NOT NULL,
    [activated] BIT DEFAULT ((0)) NOT NULL,
    [activated_at] DATETIME2,
    [last_seen_at] DATETIME2,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    [mode] VARCHAR(10) DEFAULT ('live') NOT NULL,
    [max_activations] INT DEFAULT ((5)) NOT NULL,
    CONSTRAINT [PK_user_codes] PRIMARY KEY ([code])
);

CREATE TABLE [common].[workflow_runs] (
    [workflow_name] VARCHAR(100) NOT NULL,
    [completed_at] DATETIMEOFFSET NOT NULL,
    CONSTRAINT [PK_workflow_runs] PRIMARY KEY ([workflow_name])
);

CREATE TABLE [odds].[discover_cursors] (
    [sport_key] VARCHAR(50) NOT NULL,
    [season_year] INT NOT NULL,
    [oldest_snapshot_ts] VARCHAR(30) NOT NULL,
    [snapshots_walked] INT DEFAULT ((0)) NOT NULL,
    [events_found] INT DEFAULT ((0)) NOT NULL,
    [last_walked_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_discover_cursors] PRIMARY KEY ([sport_key], [season_year])
);

CREATE TABLE [odds].[discovered_dates] (
    [scan_date] DATE NOT NULL,
    [sport_key] VARCHAR(50) NOT NULL,
    [season_year] INT NOT NULL,
    [event_count] INT DEFAULT ((0)) NOT NULL,
    [scanned_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_discovered_dates] PRIMARY KEY ([scan_date], [sport_key], [season_year])
);

CREATE TABLE [odds].[discovered_events] (
    [event_id] VARCHAR(50) NOT NULL,
    [sport_key] VARCHAR(50) NOT NULL,
    [sport_title] VARCHAR(50),
    [commence_time] DATETIME2 NOT NULL,
    [home_team] VARCHAR(100),
    [away_team] VARCHAR(100),
    [season_year] INT,
    [discovered_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_discovered_events] PRIMARY KEY ([event_id])
);

CREATE TABLE [odds].[event_game_map] (
    [event_id] VARCHAR(50) NOT NULL,
    [sport_key] VARCHAR(50) NOT NULL,
    [game_id] VARCHAR(15),
    [game_date] DATE,
    [home_tricode] CHAR(3),
    [away_tricode] CHAR(3),
    [match_method] VARCHAR(30),
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_event_game_map] PRIMARY KEY ([event_id])
);

CREATE TABLE [odds].[events] (
    [event_id] VARCHAR(50) NOT NULL,
    [sport_key] VARCHAR(50) NOT NULL,
    [sport_title] VARCHAR(50),
    [commence_time] DATETIME2 NOT NULL,
    [home_team] VARCHAR(100),
    [away_team] VARCHAR(100),
    [season_year] INT,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_events] PRIMARY KEY ([event_id])
);

CREATE TABLE [odds].[game_lines] (
    [event_id] VARCHAR(50) NOT NULL,
    [sport_key] VARCHAR(50) NOT NULL,
    [market_key] VARCHAR(100) NOT NULL,
    [bookmaker_key] VARCHAR(50) NOT NULL,
    [bookmaker_title] VARCHAR(100),
    [outcome_name] VARCHAR(100) NOT NULL,
    [outcome_price] INT,
    [outcome_point] DECIMAL(6,1),
    [snap_ts] DATETIME2,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL
);

CREATE TABLE [odds].[market_probe] (
    [probe_id] INT NOT NULL,
    [sport_key] VARCHAR(50) NOT NULL,
    [market_key] VARCHAR(100) NOT NULL,
    [market_type] VARCHAR(20),
    [bookmaker_count] INT,
    [outcome_count] INT,
    [is_covered] BIT,
    [covered_bookmakers] VARCHAR(200),
    [sample_event_ids] VARCHAR(500),
    [sample_dates] VARCHAR(200),
    [probed_at] DATETIME2,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_market_probe] PRIMARY KEY ([probe_id])
);

CREATE TABLE [odds].[player_map] (
    [odds_player_name] VARCHAR(100) NOT NULL,
    [sport_key] VARCHAR(50) NOT NULL,
    [player_id] BIGINT,
    [matched_name] VARCHAR(100),
    [match_method] VARCHAR(20),
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_player_map] PRIMARY KEY ([odds_player_name], [sport_key])
);

CREATE TABLE [odds].[player_props] (
    [event_id] VARCHAR(50) NOT NULL,
    [sport_key] VARCHAR(50) NOT NULL,
    [market_key] VARCHAR(100) NOT NULL,
    [bookmaker_key] VARCHAR(50) NOT NULL,
    [bookmaker_title] VARCHAR(100),
    [player_name] VARCHAR(100) NOT NULL,
    [outcome_name] VARCHAR(20) NOT NULL,
    [outcome_price] INT,
    [outcome_point] DECIMAL(6,1),
    [snap_ts] DATETIME2,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL
);
CREATE INDEX [IX_player_props_player_name] ON [odds].[player_props] ([player_name], [bookmaker_key], [outcome_name], [event_id]);

CREATE TABLE [odds].[team_map] (
    [odds_team_name] VARCHAR(100) NOT NULL,
    [sport_key] VARCHAR(50) NOT NULL,
    [team_tricode] CHAR(3),
    [team_id] BIGINT,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_team_map] PRIMARY KEY ([odds_team_name])
);

CREATE TABLE [odds].[upcoming_events] (
    [event_id] VARCHAR(50) NOT NULL,
    [sport_key] VARCHAR(50) NOT NULL,
    [sport_title] VARCHAR(50),
    [commence_time] DATETIME2 NOT NULL,
    [home_team] VARCHAR(100),
    [away_team] VARCHAR(100),
    [home_tricode] CHAR(3),
    [away_tricode] CHAR(3),
    [game_id] VARCHAR(15),
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_upcoming_events] PRIMARY KEY ([event_id])
);

CREATE TABLE [odds].[upcoming_game_lines] (
    [event_id] VARCHAR(50) NOT NULL,
    [sport_key] VARCHAR(50) NOT NULL,
    [market_key] VARCHAR(100) NOT NULL,
    [bookmaker_key] VARCHAR(50) NOT NULL,
    [bookmaker_title] VARCHAR(100),
    [outcome_name] VARCHAR(100) NOT NULL,
    [outcome_price] INT,
    [outcome_point] DECIMAL(6,1),
    [snap_ts] DATETIME2,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL
);

CREATE TABLE [odds].[upcoming_player_props] (
    [event_id] VARCHAR(50) NOT NULL,
    [sport_key] VARCHAR(50) NOT NULL,
    [market_key] VARCHAR(100) NOT NULL,
    [bookmaker_key] VARCHAR(50) NOT NULL,
    [bookmaker_title] VARCHAR(100),
    [player_name] VARCHAR(100) NOT NULL,
    [player_id] BIGINT,
    [outcome_name] VARCHAR(20) NOT NULL,
    [outcome_price] INT,
    [outcome_point] DECIMAL(6,1),
    [snap_ts] DATETIME2,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    [link] VARCHAR(500)
);

CREATE TABLE [odds].[upcoming_player_props_archive] (
    [event_id] VARCHAR(50) NOT NULL,
    [sport_key] VARCHAR(50) NOT NULL,
    [market_key] VARCHAR(100) NOT NULL,
    [bookmaker_key] VARCHAR(50) NOT NULL,
    [bookmaker_title] VARCHAR(100),
    [player_name] VARCHAR(100) NOT NULL,
    [player_id] BIGINT,
    [outcome_name] VARCHAR(20) NOT NULL,
    [outcome_price] INT,
    [outcome_point] DECIMAL(6,1),
    [snap_ts] DATETIME2,
    [created_at] DATETIME2 NOT NULL,
    [link] VARCHAR(500),
    [archived_at] DATETIME2
);
