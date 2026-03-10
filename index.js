// index.js
import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types, updateMessageBlock, appendMediaToMessage } from '../../../../script.js';
import { regexFromString } from '../../../utils.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { presetManager } from './presets.js'; // 引入预设管理器

const extensionName = 'st-image-auto-generation';
const extensionFolderPath = `/scripts/extensions/third-party/${extensionName}`;

const INSERT_TYPE = { DISABLED: 'disabled', INLINE: 'inline', NEW_MESSAGE: 'new', REPLACE: 'replace' };

function escapeHtmlAttribute(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const defaultSettings = {
    insertType: INSERT_TYPE.DISABLED,
    promptInjection: { enabled: true, position: 'deep_system', depth: 0 },
    customTemplates: {}, // 存储用户修改过的模板 { "Model_Style_Count_Lang": { prompt: "...", regex: "..." } }
    selections: {
        model: presetManager.MODELS[0],
        style: presetManager.STYLES[0].id,
        count: presetManager.COUNTS[0].id,
        lang: presetManager.LANGS[0].id
    }
};

// 获取当前组合的 Key
function getCurrentKey() {
    const s = extension_settings[extensionName].selections;
    return presetManager.generateKey(s.model, s.style, s.count, s.lang);
}

// 获取当前组合的数据（优先读取用户自定义，否则读取系统默认）
function getCurrentTemplateData() {
    const key = getCurrentKey();
    const custom = extension_settings[extensionName].customTemplates[key];
    if (custom) return custom;
    
    const s = extension_settings[extensionName].selections;
    return presetManager.getDefaultPreset(s.model, s.style, s.count, s.lang);
}

// 渲染下拉框选项
function renderDropdowns() {
    const populate = (selectId, dataArray, valueKey, textKey, selectedValue) => {
        const select = $(`#${selectId}`);
        select.empty();
        dataArray.forEach(item => {
            select.append($('<option>', {
                value: typeof item === 'object' ? item[valueKey] : item,
                text: typeof item === 'object' ? item[textKey] : item
            }));
        });
        select.val(selectedValue);
    };

    const s = extension_settings[extensionName].selections;
    populate('preset_model_select', presetManager.MODELS, null, null, s.model);
    populate('preset_style_select', presetManager.STYLES, 'id', 'name', s.style);
    populate('preset_count_select', presetManager.COUNTS, 'id', 'name', s.count);
    populate('preset_lang_select', presetManager.LANGS, 'id', 'name', s.lang);
}

function updateUI() {
    $('#auto_generation').toggleClass('selected', extension_settings[extensionName].insertType !== INSERT_TYPE.DISABLED);

    if ($('#image_generation_insert_type').length) {
        $('#image_generation_insert_type').val(extension_settings[extensionName].insertType);
        $('#prompt_injection_enabled').prop('checked', extension_settings[extensionName].promptInjection.enabled);
        $('#prompt_injection_position').val(extension_settings[extensionName].promptInjection.position);
        $('#prompt_injection_depth').val(extension_settings[extensionName].promptInjection.depth);
        
        renderDropdowns();
        
        const currentData = getCurrentTemplateData();
        $('#prompt_injection_text').val(currentData.prompt);
        $('#prompt_injection_regex').val(currentData.regex);
    }
}

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    } else {
        if (!extension_settings[extensionName].customTemplates) extension_settings[extensionName].customTemplates = {};
        if (!extension_settings[extensionName].selections) extension_settings[extensionName].selections = defaultSettings.selections;
        if (!extension_settings[extensionName].promptInjection) extension_settings[extensionName].promptInjection = defaultSettings.promptInjection;
        if (extension_settings[extensionName].insertType === undefined) extension_settings[extensionName].insertType = defaultSettings.insertType;
    }
    updateUI();
}

async function createSettings(settingsHtml) {
    if (!$('#image_auto_generation_container').length) {
        $('#extensions_settings2').append('<div id="image_auto_generation_container" class="extension_container"></div>');
    }
    $('#image_auto_generation_container').empty().append(settingsHtml);

    // 基础设置变更
    $('#image_generation_insert_type').on('change', function () {
        extension_settings[extensionName].insertType = $(this).val(); updateUI(); saveSettingsDebounced();
    });
    $('#prompt_injection_enabled').on('change', function () {
        extension_settings[extensionName].promptInjection.enabled = $(this).prop('checked'); saveSettingsDebounced();
    });
    $('#prompt_injection_position').on('change', function () {
        extension_settings[extensionName].promptInjection.position = $(this).val(); saveSettingsDebounced();
    });
    $('#prompt_injection_depth').on('input', function () {
        const value = parseInt(String($(this).val()));
        extension_settings[extensionName].promptInjection.depth = isNaN(value) ? 0 : value; saveSettingsDebounced();
    });

    // 下拉框组合变更
    const onSelectionChange = () => {
        extension_settings[extensionName].selections = {
            model: $('#preset_model_select').val(),
            style: $('#preset_style_select').val(),
            count: $('#preset_count_select').val(),
            lang: $('#preset_lang_select').val()
        };
        updateUI();
        saveSettingsDebounced();
    };

    $('#preset_model_select, #preset_style_select, #preset_count_select, #preset_lang_select').on('change', onSelectionChange);

    // 用户编辑文本框，自动保存为当前组合的自定义配置
    const onTextEdit = () => {
        const key = getCurrentKey();
        extension_settings[extensionName].customTemplates[key] = {
            prompt: $('#prompt_injection_text').val(),
            regex: $('#prompt_injection_regex').val()
        };
        saveSettingsDebounced();
    };

    $('#prompt_injection_text, #prompt_injection_regex').on('input', onTextEdit);

    // 恢复当前组合的默认值
    $('#btn_restore_template').on('click', function() {
        if (confirm("确定要恢复当前组合的默认提示词吗？这会覆盖你的修改！")) {
            const key = getCurrentKey();
            delete extension_settings[extensionName].customTemplates[key];
            updateUI();
            saveSettingsDebounced();
        }
    });

    // 全选按钮
    $('#btn_select_all_prompt').on('click', () => $('#prompt_injection_text').select());
    $('#btn_select_all_regex').on('click', () => $('#prompt_injection_regex').select());

    updateUI();
}

function onExtensionButtonClick() {
    const extensionsDrawer = $('#extensions-settings-button .drawer-toggle');
    if ($('#rm_extensions_block').hasClass('closedDrawer')) extensionsDrawer.trigger('click');
    setTimeout(() => {
        const container = $('#image_auto_generation_container');
        if (container.length) {
            $('#rm_extensions_block').animate({ scrollTop: container.offset().top - $('#rm_extensions_block').offset().top + $('#rm_extensions_block').scrollTop() }, 500);
            const drawerHeader = container.find('.inline-drawer-header');
            if (container.find('.inline-drawer-content').is(':hidden') && drawerHeader.length) drawerHeader.trigger('click');
        }
    }, 500);
}

$(function () {
    (async function () {
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $('#extensionsMenu').append(`<div id="auto_generation" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-robot"></div><span data-i18n="Image Auto Generation">Image Auto Generation</span>
        </div>`);
        $('#auto_generation').off('click').on('click', onExtensionButtonClick);
        await loadSettings();
        await createSettings(settingsHtml);
        $('#extensions-settings-button').on('click', () => setTimeout(updateUI, 200));
    })();
});

function getMesRole() {
    if (!extension_settings[extensionName]?.promptInjection?.position) return 'system';
    const pos = extension_settings[extensionName].promptInjection.position;
    return pos === 'deep_user' ? 'user' : pos === 'deep_assistant' ? 'assistant' : 'system';
}

// 注入提示词逻辑
eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async function (eventData) {
    try {
        if (!extension_settings[extensionName]?.promptInjection?.enabled || extension_settings[extensionName].insertType === INSERT_TYPE.DISABLED) return;

        const currentData = getCurrentTemplateData();
        const prompt = currentData.prompt;
        const depth = extension_settings[extensionName].promptInjection.depth || 0;
        const role = getMesRole();

        if (depth === 0) eventData.chat.push({ role: role, content: prompt });
        else eventData.chat.splice(-depth, 0, { role: role, content: prompt });
    } catch (error) {
        console.error(`[${extensionName}] 提示词注入错误:`, error);
    }
});

// 处理收到的消息
eventSource.on(event_types.MESSAGE_RECEIVED, async function() {
    if (!extension_settings[extensionName] || extension_settings[extensionName].insertType === INSERT_TYPE.DISABLED) return;

    const context = getContext();
    const message = context.chat[context.chat.length - 1];
    if (!message || message.is_user) return;

    const currentData = getCurrentTemplateData();
    const imgTagRegex = regexFromString(currentData.regex);
    let matches;
    if (imgTagRegex.global) {
        matches = [...message.mes.matchAll(imgTagRegex)];
    } else {
        const singleMatch = message.mes.match(imgTagRegex);
        matches = singleMatch ? [singleMatch] : [];
    }

    if (matches.length > 0) {
        setTimeout(async () => {
            try {
                toastr.info(`Generating ${matches.length} images...`);
                const insertType = extension_settings[extensionName].insertType;
                if (!message.extra) message.extra = {};
                if (!Array.isArray(message.extra.image_swipes)) message.extra.image_swipes = [];
                if (message.extra.image && !message.extra.image_swipes.includes(message.extra.image)) {
                    message.extra.image_swipes.push(message.extra.image);
                }

                const messageElement = $(`.mes[mesid="${context.chat.length - 1}"]`);

                for (const match of matches) {
                    const prompt = typeof match?.[1] === 'string' ? match[1] : '';
                    if (!prompt.trim()) continue;

                    // @ts-ignore
                    const result = await SlashCommandParser.commands['sd'].callback(
                        { quiet: insertType === INSERT_TYPE.NEW_MESSAGE ? 'false' : 'true' }, prompt
                    );
                    
                    if (insertType === INSERT_TYPE.INLINE && typeof result === 'string' && result.trim().length > 0) {
                        message.extra.image_swipes.push(result);
                        message.extra.image = result;
                        message.extra.title = prompt;
                        message.extra.inline_image = true;
                        appendMediaToMessage(message, messageElement);
                        await context.saveChat();
                    } else if (insertType === INSERT_TYPE.REPLACE && typeof result === 'string' && result.trim().length > 0) {
                        const originalTag = typeof match?.[0] === 'string' ? match[0] : '';
                        if (originalTag) {
                            const newImageTag = `<img src="${escapeHtmlAttribute(result)}" title="${escapeHtmlAttribute(prompt)}" alt="${escapeHtmlAttribute(prompt)}">`;
                            message.mes = message.mes.replace(originalTag, newImageTag);
                            updateMessageBlock(context.chat.length - 1, message);
                            await eventSource.emit(event_types.MESSAGE_UPDATED, context.chat.length - 1);
                            await context.saveChat();
                        }
                    }
                }
                toastr.success(`${matches.length} images generated successfully`);
            } catch (error) {
                toastr.error(`Image generation error: ${error}`);
            }
        }, 0);
    }
});