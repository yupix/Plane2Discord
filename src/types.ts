// ----------------------------------------------------------------
// 1. 再利用可能なエンティティ型 (変更なし)
// ----------------------------------------------------------------

export interface User {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  avatar: string;
  avatar_url: string;
  display_name: string;
}

export interface IssueLabel {
  id: string;
  name: string;
  color: string;
}

export interface IssueState {
  id: string;
  name: string;
  color: string;
  group: string;
}

// ----------------------------------------------------------------
// 2. メインのデータ型 (変更なし)
// ----------------------------------------------------------------

export interface IssueComment {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  comment_stripped: string;
  comment_html: string;
  attachments: unknown[];
  access: "INTERNAL";
  external_source: null;
  external_id: null;
  edited_at: null;
  created_by: string;
  updated_by: string | null;
  project: string;
  workspace: string;
  issue: string;
  actor: string;
}

export interface Issue {
  id: string;
  labels: IssueLabel[];
  assignees: User[];
  state: IssueState;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  point: number | null;
  name: string;
  description: unknown;
  description_html: string;
  description_stripped: string;
  description_binary: unknown | null;
  priority: string;
  start_date: string;
  target_date: string;
  sequence_id: number;
  sort_order: number;
  completed_at: string | null;
  archived_at: string | null;
  is_draft: false;
  external_source: null;
  external_id: null;
  created_by: string;
  updated_by: string | null;
  project: string;
  workspace: string;
  parent: string | null;
  estimate_point: number | null;
  type: string | null;
}

export interface DeletedObject {
  id: string;
}

// ----------------------------------------------------------------
// 3. Activity型 (修正あり)
// ----------------------------------------------------------------

/** 更新アクティビティ (変更履歴) */
interface Activity {
  /**
   * 変更されたフィールド名。 (例: "assignees", "priority", "labels")
   * created や deleted の場合は null や "issue", "description" などが入る。
   */
  field: string | null;
  /**
   * 変更後の値。
   * created や deleted の場合は null のことが多い。
   * (例: "medium", "yupix", ["id1", "id2"])
   */
  old_value: unknown;
  /**
   * 変更前の値。
   * created や deleted の場合は null のことが多い。
   * (例: "urgent", null, "kind/新機能")
   */
  new_value: unknown;
  /** 変更を行ったユーザー */
  actor: User;
  /** 変更前のID (例: ラベル削除時のラベルID) */
  old_identifier: string | null;
  /** 変更後のID (例: 担当者追加時のユーザーID) */
  new_identifier: string | null;
}

// ----------------------------------------------------------------
// 4. Webhookの型 (修正あり)
// ----------------------------------------------------------------

/** 全てのWebhookイベントで共通の基本プロパティ */
interface WebhookBodyBase {
  webhook_id: string;
  workspace_id: string;
}

// --- Issueイベント ---

interface IssueCreatedEvent extends WebhookBodyBase {
  event: "issue";
  action: "created";
  data: Issue;
  /** [修正] created でも activity オブジェクトは存在する */
  activity: Activity;
  old_identifier: null; // ログに基づき null 固定
  new_identifier: null; // ログに基づき null 固定
}

interface IssueUpdatedEvent extends WebhookBodyBase {
  event: "issue";
  action: "updated";
  data: Issue;
  activity: Activity;
  old_identifier: string | null;
  new_identifier: string | null;
}

interface IssueDeletedEvent extends WebhookBodyBase {
  event: "issue";
  action: "deleted";
  data: DeletedObject;
  /** [修正] deleted でも activity オブジェクトは存在する */
  activity: Activity;
  old_identifier: null; // ログに基づき null 固定
  new_identifier: null; // ログに基づき null 固定
}

// --- Issue Commentイベント ---

interface IssueCommentCreatedEvent extends WebhookBodyBase {
  event: "issue_comment";
  action: "created";
  data: IssueComment;
  /** [修正] created でも activity オブジェクトは存在する */
  activity: Activity;
  old_identifier: null; // ログに基づき null 固定
  new_identifier: string | null; // ログに基づき string | null
}

/** (参考) APIがコメントの更新・削除をサポートしている場合の型 */
interface IssueCommentUpdatedEvent extends WebhookBodyBase {
  event: "issue_comment";
  action: "updated";
  data: IssueComment;
  activity: Activity;
  old_identifier: string | null;
  new_identifier: string | null;
}

interface IssueCommentDeletedEvent extends WebhookBodyBase {
  event: "issue_comment";
  action: "deleted";
  data: DeletedObject;
  /** [修正] deleted でも activity オブジェクトは存在する */
  activity: Activity;
  old_identifier: string | null; // (未確認だが推測)
  new_identifier: string | null; // (未確認だが推測)
}

/**
 * Webhookで送信されるBodyの最終的な型
 */
export type WebhookBody =
  | IssueCreatedEvent
  | IssueUpdatedEvent
  | IssueDeletedEvent
  | IssueCommentCreatedEvent
  | IssueCommentUpdatedEvent
  | IssueCommentDeletedEvent;