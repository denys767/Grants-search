function formatOpportunityType(type) {
    const labels = {
        grant: 'Грант',
        competition: 'Конкурс',
        tender: 'Тендер'
    };
    return labels[type] || labels.grant;
}

function formatGrantMetadata(grant, inline = false) {
    const type = `Тип: ${formatOpportunityType(grant.type)}`;
    const lowBudget = grant.low_budget ? '⚠️ low_budget' : '';
    return inline
        ? [type, lowBudget].filter(Boolean).map(value => ` | ${value}`).join('')
        : [type, lowBudget].filter(Boolean).join('\n');
}

module.exports = { formatOpportunityType, formatGrantMetadata };
