const { App } = require('@slack/bolt');
const { getGrants, getGrantCategories, getWeeklyGrants } = require('../lib/db');

// Helper function to format date for display
function formatDeadline(deadline) {
    if (!deadline) return 'N/A';
    
    try {
        const date = new Date(deadline);
        // Format as dd-mm-yyyy for Ukrainian users
        return date.toLocaleDateString('uk-UA', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch (error) {
        return 'N/A';
    }
}

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
});

async function sendWeeklyGrants(grants = null) {
    try {
        let newGrants;
        if (grants) {
            newGrants = grants;
        } else {
            newGrants = await getWeeklyGrants();
        }
        
        if (newGrants.length > 0) {
            let message = `📊 *Нові гранти знайдені під час останнього пошуку*\nЗнайдено ${newGrants.length} нових грантів:\n\n`;
            newGrants.forEach((grant, index) => {
                const deadline = grant.deadline ? ` | Дедлайн: ${formatDeadline(grant.deadline)}` : '';
                const category = grant.category ? ` | ${grant.category}` : '';
                message += `${index + 1}. <${grant.url}|${grant.title}>${deadline}${category}\n`;
            });
            
            message += `\n💡 Використовуйте \`/grants\` для детального перегляду та фільтрації`;

            await app.client.chat.postMessage({
                token: process.env.SLACK_BOT_TOKEN,
                channel: process.env.SLACK_CHANNEL_ID,
                text: message,
                unfurl_links: false,
                unfurl_media: false
            });
            
            console.log(`📧 Report sent: ${newGrants.length} grants`);
        } else {
            console.log('📧 No new grants to report');
        }
    } catch (error) {
        console.error('Error sending grants report to Slack:', error.message);
        throw error;
    }
}

// Send newly found grants right after scraping (list of raw grant objects that were just inserted)
async function sendImmediateNewGrants(newGrants) {
    try {
        if (!newGrants || newGrants.length === 0) {
            console.log('📭 No freshly inserted grants to announce.');
            return;
        }

        let message = `*Нові гранти (${newGrants.length}) отримані з пошуку:*
\n`;
        newGrants.forEach((grant, idx) => {
            const deadline = grant.deadline ? ` | Дедлайн: ${formatDeadline(grant.deadline)}` : '';
            const category = grant.category ? ` | ${grant.category}` : '';
            message += `${idx + 1}. <${grant.url}|${grant.title}>${deadline}${category}\n`;
        });
        message += `\nℹ️ Ці гранти будуть включені до щотижневого звіту. Використовуйте \`/grants\` для перегляду всіх.`;

        await app.client.chat.postMessage({
            token: process.env.SLACK_BOT_TOKEN,
            channel: process.env.SLACK_CHANNEL_ID,
            text: message,
            unfurl_links: false,
            unfurl_media: false
        });
        console.log(`📨 Posted immediate notification for ${newGrants.length} new grants.`);
    } catch (error) {
        console.error('Error sending immediate new grants:', error.message);
    }
}

// Helper function to build the grant list message
async function buildGrantsView(category = 'all', page = 1, sortOrder = 'asc', hideExpired = false) {
    const limit = 5; // 5 grants per page
    const { grants, total } = await getGrants({ category, page, limit, sortOrder, hideExpired });
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
        {
            "type": "actions",
            "elements": [
                {
                    "type": "checkboxes",
                    "action_id": "toggle_expired",
                    "options": [
                        {
                            "text": { "type": "plain_text", "text": "Приховати прострочені та <10 днів" },
                            "value": "hide_expired"
                        }
                    ],
                    ...(hideExpired && {
                        "initial_options": [
                            {
                                "text": { "type": "plain_text", "text": "Приховати прострочені та <10 днів" },
                                "value": "hide_expired"
                            }
                        ]
                    })
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
                    "text": `🔗*<${grant.url}|${grant.title}>*\n*⏰Дедлайн:* ${formatDeadline(grant.deadline)}\n*📦Категорія:* ${grant.category}`
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
            "value": JSON.stringify({ category, page: page - 1, sortOrder, hideExpired })
        });
    }
    if (page < totalPages) {
        paginationActions.push({
            "type": "button",
            "text": { "type": "plain_text", "text": "Наступна ➡️" },
            "action_id": "next_page",
            "value": JSON.stringify({ category, page: page + 1, sortOrder, hideExpired })
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

// Helper function to extract current state from the view
function extractStateFromView(body) {
    const actionsBlocks = body.message.blocks.filter(b => b.type === 'actions');
    if (actionsBlocks.length === 0) return { category: 'all', sortOrder: 'asc', hideExpired: false };

    // Find controls in different action blocks
    let categoryElement, sortElement, expiredElement;
    
    actionsBlocks.forEach(block => {
        if (!categoryElement) categoryElement = block.elements.find(e => e.action_id === 'filter_by_category');
        if (!sortElement) sortElement = block.elements.find(e => e.action_id === 'sort_by_deadline');
        if (!expiredElement) expiredElement = block.elements.find(e => e.action_id === 'toggle_expired');
    });

    const category = categoryElement?.initial_option?.value || 'all';
    const sortOrder = sortElement?.initial_option?.value || 'asc';
    const hideExpired = expiredElement?.initial_options?.length > 0 || false;

    return { category, sortOrder, hideExpired };
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
        console.error('Error in /grants command:', error.message);
        await client.chat.postMessage({
            channel: command.channel_id,
            text: "❌ Помилка при отриманні грантів. Спробуйте пізніше.",
            unfurl_links: false,
            unfurl_media: false
        });
    }
});

const updateGrantsView = async ({ ack, body, client, action }) => {
    await ack();
    try {
        const { category, page, sortOrder, hideExpired } = JSON.parse(action.value);
        const view = await buildGrantsView(category, page, sortOrder, hideExpired);
        await client.chat.update({
            channel: body.channel.id,
            ts: body.message.ts,
            blocks: view.blocks,
            text: "Ось оновлений список грантів",
            unfurl_links: false,
            unfurl_media: false
        });
    } catch (error) {
        console.error('Error updating grants view:', error.message);
    }
};

app.action('next_page', updateGrantsView);
app.action('prev_page', updateGrantsView);

app.action('filter_by_category', async ({ ack, body, client, action }) => {
    await ack();
    try {
        const newCategory = action.selected_option.value;
        const { sortOrder, hideExpired } = extractStateFromView(body);
        const view = await buildGrantsView(newCategory, 1, sortOrder, hideExpired); // Reset to page 1
        await client.chat.update({
            channel: body.channel.id,
            ts: body.message.ts,
            blocks: view.blocks,
            text: "Ось відфільтрований список грантів",
            unfurl_links: false,
            unfurl_media: false
        });
    } catch (error) {
        console.error('Error filtering by category:', error.message);
    }
});

app.action('sort_by_deadline', async ({ ack, body, client, action }) => {
    await ack();
    try {
        const newSortOrder = action.selected_option.value;
        const { category, hideExpired } = extractStateFromView(body);
        const view = await buildGrantsView(category, 1, newSortOrder, hideExpired); // Reset to page 1
        await client.chat.update({
            channel: body.channel.id,
            ts: body.message.ts,
            blocks: view.blocks,
            text: "Ось відсортований список грантів",
            unfurl_links: false,
            unfurl_media: false
        });
    } catch (error) {
        console.error('Error sorting by deadline:', error.message);
    }
});

app.action('toggle_expired', async ({ ack, body, client, action }) => {
    await ack();
    try {
        const newHideExpired = action.selected_options.length > 0;
        const { category, sortOrder } = extractStateFromView(body);
        const view = await buildGrantsView(category, 1, sortOrder, newHideExpired); // Reset to page 1
        await client.chat.update({
            channel: body.channel.id,
            ts: body.message.ts,
            blocks: view.blocks,
            text: newHideExpired ? "Прострочені та ті що <10 днів гранти приховані" : "Показано всі гранти",
            unfurl_links: false,
            unfurl_media: false
        });
    } catch (error) {
        console.error('Error toggling expired filter:', error.message);
    }
});

async function startSlackApp() {
    try {
        await app.start(process.env.PORT || 3000);
        console.log('⚡️ Slack bot started successfully!');
    } catch (error) {
        console.error('💥 Failed to start Slack bot:', error.message);
        throw error;
    }
}

module.exports = { sendWeeklyGrants, startSlackApp };
