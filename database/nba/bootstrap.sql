-- Generated 2026-05-05. Apply in order: common/odds schemas first, then sport schemas.

CREATE TABLE [nba].[daily_lineups] (
    [game_id] VARCHAR(15) NOT NULL,
    [game_date] DATE NOT NULL,
    [home_away] VARCHAR(5) NOT NULL,
    [team_tricode] CHAR(3) NOT NULL,
    [player_name] VARCHAR(100) NOT NULL,
    [position] VARCHAR(10),
    [lineup_status] VARCHAR(30),
    [roster_status] VARCHAR(20),
    [starter_status] VARCHAR(10),
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_daily_lineups] PRIMARY KEY ([game_id], [team_tricode], [player_name])
);
CREATE INDEX [cx_nba_lineups_date] ON [nba].[daily_lineups] ([game_date], [game_id], [team_tricode], [player_name]);

CREATE TABLE [nba].[games] (
    [game_id] VARCHAR(15) NOT NULL,
    [game_date] DATE NOT NULL,
    [season_type] VARCHAR(20),
    [game_code] VARCHAR(30),
    [game_status] TINYINT,
    [game_status_text] VARCHAR(30),
    [home_team_id] BIGINT,
    [home_team_tricode] CHAR(3),
    [home_score] SMALLINT,
    [away_team_id] BIGINT,
    [away_team_tricode] CHAR(3),
    [away_score] SMALLINT,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_games] PRIMARY KEY ([game_id])
);
CREATE INDEX [cx_nba_games_date] ON [nba].[games] ([game_date], [game_id]);

CREATE TABLE [nba].[player_box_score_stats] (
    [game_id] VARCHAR(15) NOT NULL,
    [player_id] BIGINT NOT NULL,
    [period] VARCHAR(5) NOT NULL,
    [season_year] VARCHAR(10),
    [player_name] VARCHAR(100),
    [team_id] BIGINT,
    [team_tricode] CHAR(3),
    [game_date] DATE,
    [matchup] VARCHAR(20),
    [minutes] DECIMAL(6,2),
    [minutes_sec] VARCHAR(10),
    [fgm] SMALLINT,
    [fga] SMALLINT,
    [fg_pct] DECIMAL(6,4),
    [fg3m] SMALLINT,
    [fg3a] SMALLINT,
    [fg3_pct] DECIMAL(6,4),
    [ftm] SMALLINT,
    [fta] SMALLINT,
    [ft_pct] DECIMAL(6,4),
    [oreb] SMALLINT,
    [dreb] SMALLINT,
    [reb] SMALLINT,
    [ast] SMALLINT,
    [tov] SMALLINT,
    [stl] SMALLINT,
    [blk] SMALLINT,
    [blka] SMALLINT,
    [pf] SMALLINT,
    [pfd] SMALLINT,
    [pts] SMALLINT,
    [plus_minus] SMALLINT,
    [dd2] SMALLINT,
    [td3] SMALLINT,
    [available_flag] SMALLINT,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_player_box_score_stats] PRIMARY KEY ([game_id], [player_id], [period])
);
CREATE INDEX [cx_nba_pbss_date] ON [nba].[player_box_score_stats] ([game_date], [game_id], [player_id], [period]);

CREATE TABLE [nba].[player_passing_stats] (
    [player_id] BIGINT NOT NULL,
    [game_date] DATE NOT NULL,
    [player_name] VARCHAR(100),
    [team_id] BIGINT,
    [team_tricode] CHAR(3),
    [potential_ast] DECIMAL(8,1),
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_player_passing_stats] PRIMARY KEY ([player_id], [game_date])
);
CREATE INDEX [cx_nba_pps_date] ON [nba].[player_passing_stats] ([game_date], [player_id]);

CREATE TABLE [nba].[player_rebound_chances] (
    [player_id] BIGINT NOT NULL,
    [game_date] DATE NOT NULL,
    [player_name] VARCHAR(100),
    [team_id] BIGINT,
    [team_tricode] CHAR(3),
    [reb_chances] DECIMAL(8,1),
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_player_rebound_chances] PRIMARY KEY ([player_id], [game_date])
);
CREATE INDEX [cx_nba_prc_date] ON [nba].[player_rebound_chances] ([game_date], [player_id]);

CREATE TABLE [nba].[player_usage_stats] (
    [usage_id] INT NOT NULL,
    [game_id] VARCHAR(15) NOT NULL,
    [game_date] DATE NOT NULL,
    [player_id] BIGINT NOT NULL,
    [player_name] NVARCHAR(100),
    [team_id] BIGINT,
    [team_tricode] CHAR(3),
    [minutes] FLOAT,
    [usage_pct] FLOAT,
    [est_usage_pct] FLOAT,
    [pace] FLOAT,
    [pace_per40] FLOAT,
    [possessions] INT,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_player_usage_stats] PRIMARY KEY ([usage_id])
);
CREATE UNIQUE INDEX [uq_player_usage_stats] ON [nba].[player_usage_stats] ([game_id], [player_id]);

CREATE TABLE [nba].[players] (
    [player_id] BIGINT NOT NULL,
    [player_name] VARCHAR(100) NOT NULL,
    [team_id] BIGINT,
    [team_name] VARCHAR(60),
    [team_tricode] CHAR(3),
    [roster_status] TINYINT,
    [from_year] SMALLINT,
    [to_year] SMALLINT,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    [position] VARCHAR(10),
    CONSTRAINT [PK_players] PRIMARY KEY ([player_id])
);

CREATE TABLE [nba].[schedule] (
    [game_id] VARCHAR(15) NOT NULL,
    [game_date] DATE NOT NULL,
    [season_type] VARCHAR(20),
    [game_code] VARCHAR(30),
    [game_status] TINYINT,
    [game_status_text] VARCHAR(30),
    [home_team_id] BIGINT,
    [home_team_tricode] CHAR(3),
    [home_score] SMALLINT,
    [away_team_id] BIGINT,
    [away_team_tricode] CHAR(3),
    [away_score] SMALLINT,
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_schedule] PRIMARY KEY ([game_id])
);
CREATE INDEX [cx_nba_schedule_date] ON [nba].[schedule] ([game_date], [game_id]);

CREATE TABLE [nba].[teams] (
    [team_id] BIGINT NOT NULL,
    [team_name] VARCHAR(60) NOT NULL,
    [team_tricode] CHAR(3) NOT NULL,
    [conference] VARCHAR(10),
    [division] VARCHAR(20),
    [created_at] DATETIME2 DEFAULT (getutcdate()) NOT NULL,
    CONSTRAINT [PK_teams] PRIMARY KEY ([team_id])
);
CREATE UNIQUE INDEX [uq_nba_tricode] ON [nba].[teams] ([team_tricode]);
