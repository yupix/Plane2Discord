import { uploadImageToS3 } from "../s3.ts";
import { WebhookBody, User } from "../types.ts";
import { buildPayload, convertColor, safe } from "./helpers.ts";

import { planeClient } from "./plane.ts";
import { APIEmbed } from "npm:discord-api-types/v10";

function getActorAvatar(user: User) {
    return Deno.env.get("PLANE_HOSTNAME")
        ? `https://${Deno.env.get("PLANE_HOSTNAME")}${user.avatar_url}`
        : undefined;
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

async function getLabelNames(labelIds: string[], workspaceId: string, projectId: string): Promise<string[]> {
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

export async function handleCreated(
  payload: WebhookBody,
) {
  if (payload.action !== "created") return;

  switch (payload.event) {
    case "issue": {
    const labels = await getLabelNames(
        payload.data.labels.map(label => label.id),
        payload.workspace_id,
        payload.data.project,
      );
      console.log("Labels:", labels);
      const workItem = await planeClient.workItems.retrieve(
        payload.workspace_id,
        payload.data.project,
        payload.data.id,
      );
      console.log(workItem)
      const file_url = await uploadImageToS3(getActorAvatar(payload.activity?.actor)!);
      console.log(file_url);

      const embed: APIEmbed = {
        title: payload.data.name,
        // url:
        description: payload.data.description_stripped,
        author: {
            name: payload.activity.actor.display_name,
            icon_url: file_url,
        },
        // 青色
        color: 0x3498db,
      }

      return {embeds: [embed]};
      break;
    }
    case "issue_comment":
      {
        payload.data;
        break;
      }

    default:
      break;
  }

  const fields = [
    { name: "Card", value: safe(data.name), inline: true },
    { name: "Project", value: `ID: \`${safe(data.project)}\``, inline: true },
    { name: "State", value: safe(data.state?.name), inline: true },
    {
      name: "Created At",
      value: new Date(data.created_at || Date.now()).toLocaleString(),
      inline: true,
    },
    {
      name: "Created By",
      value: `${safe(activity?.actor?.display_name)}`,
      inline: true,
    },
  ];

  return buildPayload({
    title: "New Card Created",
    description: `**${safe(data.name)}** added to project`,
    fields,
    color: convertColor(data.state?.color),
    timestamp: new Date(data.created_at || Date.now()).toISOString(),
    actorAvatar: getActorAvatar(activity?.actor) || getActorAvatar(data?.actor),
    headers,
    footerText: "Card created",
  });
}

export function handleDeleted(
  data: DeletedData = {},
  activity: Activity = {},
  headers: Record<string, string> = {},
  _eventName: EventType | undefined = undefined,
) {
  const fields = [
    { name: "Card ID", value: safe(data.id), inline: true },
    {
      name: "Deleted By",
      value: `${safe(activity?.actor?.display_name)}`,
      inline: true,
    },
  ];

  return buildPayload({
    title: "Card Deleted",
    description: `Card **${safe(data.id)}** has been deleted`,
    fields,
    color: 0xff4444,
    timestamp: new Date().toISOString(),
    actorAvatar: getActorAvatar(activity?.actor) || getActorAvatar(data?.actor),
    headers,
    footerText: "Card removed",
  });
}

export function handleUpdated(
  data: UpdatedData = {},
  activity: Activity = {},
  headers: Record<string, string> = {},
  _eventName: EventType | undefined = undefined,
) {
  const actionDesc = getActionDescription(activity);
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Card", value: safe(data.name), inline: true },
    { name: "Change", value: actionDesc, inline: true },
    { name: "Project", value: `ID: \`${safe(data.project)}\``, inline: true },
    {
      name: "Updated By",
      value: `${safe(activity?.actor?.display_name)}`,
      inline: true,
    },
  ];

  let description = `**${safe(data.name)}** updated`;
  if (_eventName === "issue_comment") {
    const commentText = data?.comment_stripped || activity?.new_value ||
      data?.comment_html || activity?.new_value;
    if (commentText) {
      description = `Comment: ${String(commentText).replace(/<[^>]*>/g, "")}`;
      fields.unshift({
        name: "Comment",
        value: (data?.comment_stripped || String(commentText).slice(0, 200)),
        inline: false,
      });
    }
  } else if (activity?.field === "description") {
    const newDesc = activity?.new_value || data?.description ||
      data?.comment_stripped;
    if (newDesc) {
      fields.unshift({
        name: "Description",
        value: String(newDesc).replace(/<[^>]*>/g, ""),
        inline: false,
      });
    }
  }

  return buildPayload({
    title: "Card Updated",
    description,
    fields,
    color: convertColor(data.state?.color),
    timestamp: new Date(data.updated_at || Date.now()).toISOString(),
    actorAvatar: getActorAvatar(activity?.actor) || getActorAvatar(data?.actor),
    footerText: "Card updated",
    headers,
  });
}
