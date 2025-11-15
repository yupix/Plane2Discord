import { Activity, User, WebhookBody } from "../types";
import { APIEmbed, APIEmbedField, EmbedType } from "discord-api-types/v10";
import { planeClient } from "./plane";
import { env } from "../env";

function getActorAvatar(user: User) {
  const host = env.PLANE_HOSTNAME;
  return host ? `https://${host}${user.avatar_url}` : undefined;
}

export function getActionDescription(activity: Activity | undefined): string {
  const { field, old_value, new_value } = activity || {};

  switch (field) {
    case "state_id":
      return `State ID changed from ${old_value} to ${new_value}`;
    case "state":
      return `Moved from **${old_value}** to **${new_value}**`;
    case "sort_order":
      return `Reordered (priority changed)`;
    default:
      return `Field **${field}** updated`;
  }
}

async function getLabelNames(
  labelIds: string[],
  workspaceId: string,
  projectId: string,
): Promise<string[]> {
  const labelNames: string[] = [];
  for (const labelId of labelIds) {
    const labelInfo = await planeClient.labels.retrieve(
      workspaceId,
      projectId,
      labelId,
    );
    labelNames.push(labelInfo.name);
  }
  return labelNames;
}

function getEmbedTitle(workspace:string, projectIdentifier:string, issueSequenceId:string, msg:string): string {
  return `[${workspace}] ${msg} ${projectIdentifier}-${issueSequenceId}`;
}

/**
 * 共通ロジック: 課題に関連するコンテキスト（プロジェクト、作業項目、URL）を取得する
 */
async function getIssueContext(
  workspaceId: string,
  projectId: string,
  issueId: string,
) {
  // プロジェクト情報と作業項目情報を並列で取得
  const [project, workItem] = await Promise.all([
    planeClient.projects.retrieve(workspaceId, projectId),
    planeClient.workItems.retrieve(workspaceId, projectId, issueId),
  ]);

  // 共通のURLを構築
  const issueUrl =
    `${env.PLANE_API_BASE_URL}/${workspaceId}/browse/${project.identifier}-${workItem.sequence_id}/`;

  return { project, workItem, issueUrl };
}

export async function handleCreated(
  payload: WebhookBody,
) {
  if (payload.action !== "created") return;

  // 共通の実行者（Actor）情報を先に取得
  const actor = payload.activity.actor;
  const actorAvatar = getActorAvatar(actor) || undefined;

  switch (payload.event) {
    case "issue": {
      // 共通ヘルパーでコンテキストを取得
      const { project, workItem, issueUrl } = await getIssueContext(
        payload.workspace_id,
        payload.data.project,
        payload.data.id, // "issue" event は data.id を使用
      );

      // "issue" 固有のロジック (ラベル取得)
      const labels = await getLabelNames(
        payload.data.labels.map((label) => label.id),
        payload.workspace_id,
        payload.data.project,
      );
      console.log("Labels:", labels);
      console.log(workItem);

      // (改善点) 取得したラベルをEmbedのフィールドに追加
      const fields: APIEmbedField[] = [];
      if (labels.length > 0) {
        fields.push({
          name: "Labels",
          value: labels.join(", "),
          inline: true,
        });
      }

      fields.push({
        name: "Status",
        value: payload.data.state.name,
        inline: true,
      });

      fields.push({
        name: "Priority",
        value: payload.data.priority,
        inline: true,
      })

      if (payload.data.assignees.length > 0) {
        const assigneeNames = payload.data.assignees.map(assignee => assignee.display_name);
        fields.push({
          name: "Assignees",
          value: assigneeNames.join(", "),
          inline: true,
        });
      }

      

      const embed: APIEmbed = {
        title: payload.data.name,
        description: payload.data.description_stripped,
        author: {
          name: actor.display_name,
          icon_url: actorAvatar, // 共通変数を使用
        },
        type: EmbedType.Rich,


        color: 0x3498db, // 青色
        url: issueUrl, // 共通ヘルパーから取得
        fields: fields, // 追加
      };

      return { embeds: [embed] };
    }
    case "issue_comment": {
      // 共通ヘルパーでコンテキストを取得
      const { project, workItem, issueUrl } = await getIssueContext(
        payload.workspace_id,
        payload.data.project,
        payload.data.issue, // "issue_comment" event は data.issue を使用
      );

      const embed: APIEmbed = {
        title:
          `[${payload.workspace_id}] New comment on issue #${project.identifier}-${workItem.sequence_id}: ${workItem.name}`,
        description: payload.data.comment_stripped,
        author: {
          name: actor.display_name,
          icon_url: actorAvatar, // 共通変数を使用
        },
        color: 0x8eda8e, // 緑色
        url: issueUrl, // 共通ヘルパーから取得
      };
      return { embeds: [embed] };
    }

    default:
      break;
  }
}

export function handleDeleted(
  data: WebhookBody,
) {
  if (data.action !== "deleted") return;

  const actor = data.activity.actor;
  const actorAvatar = getActorAvatar(actor) || undefined;
  const embed: APIEmbed = {
    title: `Card Deleted`,
    description: `Deleted issue ID: ${data.data.id}`,
    author: {
      name: actor.display_name,
      icon_url: actorAvatar
    },
    color: 0xff4444,
  };
  return { embeds: [embed] };
}

export async function handleUpdated(
  data: WebhookBody,
) {
  if (data.action !== "updated") return;

  const actor = data.activity.actor;
  const actorAvatar = getActorAvatar(actor) || undefined;
  const fields: APIEmbedField[] = [];

  const { project, workItem, issueUrl } = await getIssueContext(
        data.workspace_id,
        data.data.project,
        data.data.id, // "issue" event は data.id を使用
      ); 

  fields.push({
    name: data.activity.field || "Update",
    value: `Changed from "${data.activity.old_value}" to "${data.activity.new_value}"`,
    inline: true,
  })

  let title = `Card Updated`;

  // stateがdoneになった場合は緑色、in-progressなら黄色、その他は青色にする
  let color = 0x3498db; // デフォルトは青色
  if (data.activity.field === "state") {
    if (String(data.activity.new_value).toLowerCase() === "done") {
      color = 0x8eda8e; // 緑色
      title = `Issue Completed`;
    } else if (String(data.activity.new_value).toLowerCase() === "in-progress") {
      color = 0xffd700; // 黄色
  
    }
  }

  const embed: APIEmbed = {
    title: getEmbedTitle(data.workspace_id, project.identifier!, workItem.sequence_id.toString(), title),
    description: `Updated issue ID: ${data.data.id}`,
    fields: fields,
    color: color, // 色を変数に変更
    author: {
      name: actor.display_name,
      icon_url: actorAvatar
    },
    url: issueUrl,
  }
  return { embeds: [embed] };
}

// export function handleDeleted(
//   data: DeletedData = {},
//   activity: Activity = {},
//   headers: Record<string, string> = {},
//   _eventName: EventType | undefined = undefined,
// ) {
//   const fields = [
//     { name: "Card ID", value: safe(data.id), inline: true },
//     {
//       name: "Deleted By",
//       value: `${safe(activity?.actor?.display_name)}`,
//       inline: true,
//     },
//   ];

//   return buildPayload({
//     title: "Card Deleted",
//     description: `Card **${safe(data.id)}** has been deleted`,
//     fields,
//     color: 0xff4444,
//     timestamp: new Date().toISOString(),
//     actorAvatar: getActorAvatar(activity?.actor) || getActorAvatar(data?.actor),
//     headers,
//     footerText: "Card removed",
//   });
// }

// export function handleUpdated(
//   data: UpdatedData = {},
//   activity: Activity = {},
//   headers: Record<string, string> = {},
//   _eventName: EventType | undefined = undefined,
// ) {
//   const actionDesc = getActionDescription(activity);
//   const fields: { name: string; value: string; inline?: boolean }[] = [
//     { name: "Card", value: safe(data.name), inline: true },
//     { name: "Change", value: actionDesc, inline: true },
//     { name: "Project", value: `ID: \`${safe(data.project)}\``, inline: true },
//     {
//       name: "Updated By",
//       value: `${safe(activity?.actor?.display_name)}`,
//       inline: true,
//     },
//   ];

//   let description = `**${safe(data.name)}** updated`;
//   if (_eventName === "issue_comment") {
//     const commentText = data?.comment_stripped || activity?.new_value ||
//       data?.comment_html || activity?.new_value;
//     if (commentText) {
//       description = `Comment: ${String(commentText).replace(/<[^>]*>/g, "")}`;
//       fields.unshift({
//         name: "Comment",
//         value: (data?.comment_stripped || String(commentText).slice(0, 200)),
//         inline: false,
//       });
//     }
//   } else if (activity?.field === "description") {
//     const newDesc = activity?.new_value || data?.description ||
//       data?.comment_stripped;
//     if (newDesc) {
//       fields.unshift({
//         name: "Description",
//         value: String(newDesc).replace(/<[^>]*>/g, ""),
//         inline: false,
//       });
//     }
//   }

//   return buildPayload({
//     title: "Card Updated",
//     description,
//     fields,
//     color: convertColor(data.state?.color),
//     timestamp: new Date(data.updated_at || Date.now()).toISOString(),
//     actorAvatar: getActorAvatar(activity?.actor) || getActorAvatar(data?.actor),
//     footerText: "Card updated",
//     headers,
//   });
// }
