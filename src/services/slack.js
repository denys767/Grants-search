const { App } = require('@slack/bolt');
const { getGrants, getGrantCategories } = require('../lib/db');

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
});

async function sendWeeklyGrants() {
    const { grants } = await getGrants(); // Destructure to get grants array
    const newGrants = grants.filter(grant => {
        const grantDate = new Date(grant.created_at);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return grantDate > weekAgo;
    });

    if (newGrants.length > 0) {
        let message = 'Нові гранти за останній тиждень:\n';
        newGrants.forEach(grant => {
            message += `<${grant.url}|${grant.title}>; ${grant.deadline}; ${grant.category}\n`;
        });

        try {
            await app.client.chat.postMessage({
                token: process.env.SLACK_BOT_TOKEN,
                channel: process.env.SLACK_CHANNEL_ID,
                text: message,
                unfurl_links: false,
                unfurl_media: false
            });
        } catch (error) {
            console.error('Error sending weekly grants to Slack:', error);
        }
    }
}

// Helper function to build the grant list message
async function buildGrantsView(category = 'all', page = 1, sortOrder = 'desc') {
    const limit = 5; // 5 grants per page
    const { grants, total } = await getGrants({ category, page, limit, sortOrder });
    const categories = await getGrantCategories();
    const totalPages = Math.ceil(total / limit);

    const blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "Знайдені гранти"
            }
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "Використовуйте фільтри для пошуку грантів."
            }
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "static_select",
                    "placeholder": {
                        "type": "plain_text",
                        "text": "Фільтрувати за категорією"
                    },
                    "action_id": "filter_by_category",
                    "options": [
                        {
                            "text": { "type": "plain_text", "text": "Усі категорії" },
                            "value": "all"
                        },
                        ...categories.map(cat => ({
                            "text": { "type": "plain_text", "text": cat },
                            "value": cat
                        }))
                    ],
                    "initial_option": category ? {
                        "text": { "type": "plain_text", "text": category === 'all' ? "Усі категорії" : category },
                        "value": category
                    } : undefined
                },
                {
                    "type": "static_select",
                    "placeholder": {
                        "type": "plain_text",
                        "text": "Сортування за дедлайном"
                    },
                    "action_id": "sort_by_deadline",
                    "options": [
                        {
                            "text": { "type": "plain_text", "text": "Спочатку найближчі дедлайни" },
                            "value": "asc"
                        },
                        {
                            "text": { "type": "plain_text", "text": "Спочатку віддалені дедлайни" },
                            "value": "desc"
                        }
                    ],
                    "initial_option": {
                        "text": { 
                            "type": "plain_text", 
                            "text": sortOrder === 'asc' ? "Спочатку найближчі дедлайни" : "Спочатку віддалені дедлайни" 
                        },
                        "value": sortOrder
                    }
                }
            ]
        },
        { "type": "divider" }
    ];

    if (grants.length === 0) {
        blocks.push({
            "type": "section",
            "text": {
                "type": "plain_text",
                "text": "На жаль, за вашим запитом нічого не знайдено."
            }
        });
    } else {
        grants.forEach(grant => {
            blocks.push({ "type": "divider" });
            blocks.push({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `🔗*<${grant.url}|${grant.title}>*\n*⏰Дедлайн:* ${grant.deadline || 'N/A'}\n*📦Категорія:* ${grant.category}`
                }
            });
        });
    }

    // Pagination
    const paginationActions = [];
    if (page > 1) {
        paginationActions.push({
            "type": "button",
            "text": { "type": "plain_text", "text": "⬅️ Попередня" },
            "action_id": "prev_page",
            "value": JSON.stringify({ category, page: page - 1, sortOrder })
        });
    }
    if (page < totalPages) {
        paginationActions.push({
            "type": "button",
            "text": { "type": "plain_text", "text": "Наступна ➡️" },
            "action_id": "next_page",
            "value": JSON.stringify({ category, page: page + 1, sortOrder })
        });
    }

    if (paginationActions.length > 0) {
        blocks.push({ "type": "divider" });
        blocks.push({
            "type": "actions",
            "elements": paginationActions
        });
    }
    
    if (total > 0) {
        blocks.push({
            "type": "context",
            "elements": [
                {
                    "type": "plain_text",
                    "text": `Сторінка ${page} з ${totalPages}. Всього знайдено: ${total}`
                }
            ]
        });
    }

    return { blocks };
}

app.command('/grants', async ({ ack, command, client }) => {
    await ack();
    try {
        const view = await buildGrantsView();
        await client.chat.postMessage({
            channel: command.channel_id,
            blocks: view.blocks,
            text: "Ось список грантів", // Fallback text
            unfurl_links: false,
            unfurl_media: false
        });
    } catch (error) {
        console.error(error);
    }
});

const updateGrantsView = async ({ ack, body, client, action }) => {
    await ack();
    try {
        const { category, page, sortOrder } = JSON.parse(action.value);
        const view = await buildGrantsView(category, page, sortOrder);
        await client.chat.update({
            channel: body.channel.id,
            ts: body.message.ts,
            blocks: view.blocks,
            text: "Ось оновлений список грантів",
            unfurl_links: false,
            unfurl_media: false
        });
    } catch (error) {
        console.error(error);
    }
};

app.action('next_page', updateGrantsView);
app.action('prev_page', updateGrantsView);

app.action('filter_by_category', async ({ ack, body, client, action }) => {
    await ack();
    try {
        const category = action.selected_option.value;
        // Get current sort order from the message if possible, default to 'desc'
        const currentSortOrder = 'desc'; // You could extract this from current state if needed
        const view = await buildGrantsView(category, 1, currentSortOrder); // Reset to page 1
        await client.chat.update({
            channel: body.channel.id,
            ts: body.message.ts,
            blocks: view.blocks,
            text: "Ось відфільтрований список грантів",
            unfurl_links: false,
            unfurl_media: false
        });
    } catch (error) {
        console.error(error);
    }
});

app.action('sort_by_deadline', async ({ ack, body, client, action }) => {
    await ack();
    try {
        const sortOrder = action.selected_option.value;
        // Get current category from the message if possible, default to 'all'
        const currentCategory = 'all'; // You could extract this from current state if needed
        const view = await buildGrantsView(currentCategory, 1, sortOrder); // Reset to page 1
        await client.chat.update({
            channel: body.channel.id,
            ts: body.message.ts,
            blocks: view.blocks,
            text: "Ось відсортований список грантів",
            unfurl_links: false,
            unfurl_media: false
        });
    } catch (error) {
        console.error(error);
    }
});

async function startSlackApp() {
    await app.start(process.env.PORT || 3000);
    console.log('⚡️ Bolt app is running!');
}

module.exports = { sendWeeklyGrants, startSlackApp };
