// `cp _env .env` then modify it
// See https://github.com/motdotla/dotenv
const config = require("dotenv").config().parsed;
// Overwrite env variables anyways
for (const k in config) {
  process.env[k] = config[k];
}

const { LogLevel } = require("@slack/logger");
const logLevel = process.env.SLACK_LOG_LEVEL || LogLevel.DEBUG;

const { App, ExpressReceiver } = require("@slack/bolt");
// If you deploy this app to FaaS, turning this on is highly recommended
// Refer to https://github.com/slackapi/bolt/issues/395 for details
const processBeforeResponse = false;
// Manually instantiate to add external routes afterwards
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse,
});
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  logLevel,
  receiver,
  processBeforeResponse,
});

// Request dumper middleware for easier debugging
if (process.env.SLACK_REQUEST_LOG_ENABLED === "1") {
  app.use(async (args) => {
    const copiedArgs = JSON.parse(JSON.stringify(args));
    copiedArgs.context.botToken = 'xoxb-***';
    if (copiedArgs.context.userToken) {
      copiedArgs.context.userToken = 'xoxp-***';
    }
    copiedArgs.client = {};
    copiedArgs.logger = {};
    args.logger.debug(
      "Dumping request data for debugging...\n\n" +
      JSON.stringify(copiedArgs, null, 2) +
      "\n"
    );
    const result = await args.next();
    args.logger.debug("next() call completed");
    return result;
  });
}

// ---------------------------------------------------------------
// Start coding here..
// see https://slack.dev/bolt/

app.shortcut("count", async ({ logger, client, body, ack }) => {
  ack();
  
  // logger.debug(JSON.stringify(body));
  
  const permalink = await getPermalink({ client, body });

  const action_ts = body.action_ts.substring(0, 10);
  
  const reactions = await getReactions({ logger, client, body });
  
  if (reactions.length === 0) {
    await client.chat.postMessage({
      "channel": body.user.id,
      "text": "No one has added reaction.",
      "blocks": [
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "No one has added reaction."
          }
        },
        {
          "type": "context",
          "elements": [
            {
              "type": "mrkdwn",
              "text": `<!date^${action_ts}^Counted at {date_short_pretty} {time}|Counted at ...> | <${permalink.permalink}|View message>`
            }
          ]
        }
      ],
      "parse": "full"
    });
    
    return;
  }
  
  const users = await listUsers({ client });
  
  const res = await client.chat.postMessage({
    "channel": body.user.id,
    "text": "reactions",
    "blocks": [
      {
        "type": "section",
        "text": {
            "type": "mrkdwn",
            "text": permalink.permalink
        }
      }
    ]
  });
  
  // logger.debug("post message:" + JSON.stringify(res));
  
  await Promise.all(reactions.map(async reaction => {
    let emails = users
      .filter(user => reaction.users.includes(user.id))
      .map(user => user.profile.email)
      .join("\n");
    
    await client.files.upload({
      "channels": body.user.id,
      "content": emails,
      "initial_comment": `*Reaction:* :${reaction.name}:\n*Count:* ${reaction.count}`,
      "thread_ts": res.ts
    });
  }));
});

async function getPermalink({ client, body }) {
  return await client.chat.getPermalink({
    "channel": body.channel.id,
    "message_ts": body.message_ts
  });
}

async function listUsers({ client }) {
  const res = await client.users.list();
    
  return res.members;
}

async function getReactions({ logger, client, body }) {
  try {
    const res = await client.reactions.get({
      "channel": body.channel.id,
      "timestamp": body.message_ts,
      "full": true
    });
    
    // logger.debug("get reactions:" + JSON.stringify(res));
    
    if (! ('reactions' in res.message)) {
      return [];
    }
    
    return res.message.reactions;
  } catch (e) {
    logger.error(JSON.stringify(e, null, 2) + "\n");
    
    await client.chat.postMessage({
      "channel": body.user.id,
      "text": e.data.error,
      "blocks": [
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": `*Error*: \`${e.data.error}\``
          }
        }
      ]
    });
    
    throw e;
  }
}

// ---------------------------------------------------------------

receiver.app.get("/", (_req, res) => {
  res.send("Your Bolt ⚡️ App is running!");
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("⚡️ Bolt app is running!");
})();
