<template>
    <div class="item-row">
        <router-link :to="url" :class="{ 'dim' : !stack.isManagedByDockge }" class="item">
            <Uptime :stack="stack" :fixed-width="true" class="me-2" />
            <div class="title">
                <span>{{ stackName }}</span>
                <div v-if="$root.agentCount > 1" class="endpoint">{{ endpointDisplay }}</div>
            </div>
        </router-link>

        <BDropdown class="folder-menu" right text="⋯" variant="normal" size="sm">
            <BDropdownItem v-for="path in otherGroupPaths" :key="path" @click="moveToGroup(path)">
                <font-awesome-icon icon="folder" class="me-1" />
                {{ $t("moveToFolder") }}: {{ displayPath(path) }}
            </BDropdownItem>

            <BDropdownItem @click="showNewFolderModal = true">
                <font-awesome-icon icon="plus" class="me-1" />
                {{ $t("newFolder") }}
            </BDropdownItem>

            <BDropdownItem v-if="stack.group" @click="moveToGroup(null)">
                <font-awesome-icon icon="times" class="me-1" />
                {{ $t("removeFromFolder") }}
            </BDropdownItem>
        </BDropdown>

        <BModal v-model="showNewFolderModal" :title="$t('newFolder')" :okTitle="$t('moveToFolder')" okVariant="primary" @ok="confirmNewFolder">
            <div class="mb-3">
                <label for="newFolderName" class="form-label">{{ $t("newFolderNamePrompt") }}</label>
                <input id="newFolderName" v-model="newFolderName" type="text" class="form-control" :placeholder="$t('newFolderNameHelp')">
                <div class="form-text">{{ $t("newFolderNameHelp") }}</div>
            </div>
        </BModal>
    </div>
</template>

<script>
import Uptime from "./Uptime.vue";
import { BModal } from "bootstrap-vue-next";

export default {
    components: {
        Uptime,
        BModal,
    },
    props: {
        /** Stack this represents */
        stack: {
            type: Object,
            default: null,
        },
        /** If the user is in select mode */
        isSelectMode: {
            type: Boolean,
            default: false,
        },
        /** How many ancestors are above this stack */
        depth: {
            type: Number,
            default: 0,
        },
        /** Callback to determine if stack is selected */
        isSelected: {
            type: Function,
            default: () => {}
        },
        /** Callback fired when stack is selected */
        select: {
            type: Function,
            default: () => {}
        },
        /** Callback fired when stack is deselected */
        deselect: {
            type: Function,
            default: () => {}
        },
    },
    data() {
        return {
            isCollapsed: true,
            showNewFolderModal: false,
            newFolderName: "",
        };
    },
    computed: {
        endpointDisplay() {
            return this.$root.endpointDisplayFunction(this.stack.endpoint);
        },
        url() {
            if (this.stack.endpoint) {
                return `/compose/${this.stack.name}/${this.stack.endpoint}`;
            } else {
                return `/compose/${this.stack.name}`;
            }
        },
        depthMargin() {
            return {
                marginLeft: `${31 * this.depth}px`,
            };
        },
        stackName() {
            return this.stack.name;
        },
        /**
         * Other folder paths already in use on this stack's endpoint,
         * for the "Move to" dropdown (excludes the stack's current folder)
         * @returns {Array} Sorted list of folder paths
         */
        otherGroupPaths() {
            const paths = new Set();
            for (const key in this.$root.completeStackList) {
                const s = this.$root.completeStackList[key];
                if (s.endpoint === this.stack.endpoint && s.group && s.group !== this.stack.group) {
                    paths.add(s.group);
                }
            }
            return [ ...paths ].sort();
        },
    },
    watch: {
        isSelectMode() {
            // TODO: Resize the heartbeat bar, but too slow
            // this.$refs.heartbeatBar.resize();
        }
    },
    beforeMount() {

    },
    methods: {
        /**
         * Changes the collapsed value of the current stack and saves
         * it to local storage
         * @returns {void}
         */
        changeCollapsed() {
            this.isCollapsed = !this.isCollapsed;

            // Save collapsed value into local storage
            let storage = window.localStorage.getItem("stackCollapsed");
            let storageObject = {};
            if (storage !== null) {
                storageObject = JSON.parse(storage);
            }
            storageObject[`stack_${this.stack.id}`] = this.isCollapsed;

            window.localStorage.setItem("stackCollapsed", JSON.stringify(storageObject));
        },

        /**
         * Toggle selection of stack
         * @returns {void}
         */
        toggleSelection() {
            if (this.isSelected(this.stack.id)) {
                this.deselect(this.stack.id);
            } else {
                this.select(this.stack.id);
            }
        },

        /**
         * Format a folder path for display, e.g. "services/networking" -> "services › networking"
         * @param {string} path Folder path
         * @returns {string} Display-friendly path
         */
        displayPath(path) {
            return path.split("/").join(" › ");
        },

        /**
         * Move this stack to a folder (or remove it from one, if group is null).
         * Purely visual/organizational — no filesystem changes.
         * @param {string|null} group Folder path, or null to ungroup
         * @returns {void}
         */
        moveToGroup(group) {
            this.$root.emitAgent(this.stack.endpoint, "setStackGroup", this.stack.name, group, (res) => {
                this.$root.toastRes(res);
            });
        },

        /**
         * Confirm the "New folder" modal and move this stack into it
         * @returns {void}
         */
        confirmNewFolder() {
            if (!this.newFolderName || this.newFolderName.trim() === "") {
                return;
            }
            this.moveToGroup(this.newFolderName.trim());
            this.newFolderName = "";
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../styles/vars.scss";

.small-padding {
    padding-left: 5px !important;
    padding-right: 5px !important;
}

.collapse-padding {
    padding-left: 8px !important;
    padding-right: 2px !important;
}

.item-row {
    display: flex;
    align-items: center;
    width: 100%;
}

.folder-menu {
    flex-shrink: 0;

    :deep(.dropdown-toggle) {
        padding: 2px 8px;
        line-height: 1;
    }
}

.item {
    text-decoration: none;
    display: flex;
    align-items: center;
    min-height: 52px;
    border-radius: 10px;
    transition: all ease-in-out 0.15s;
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    &.disabled {
        opacity: 0.3;
    }
    &:hover {
        background-color: $highlight-white;
    }
    &.active {
        background-color: #cdf8f4;
    }
    .title {
        margin-top: -4px;
    }
    .endpoint {
        font-size: 12px;
        color: $dark-font-color3;
    }
}

.collapsed {
    transform: rotate(-90deg);
}

.animated {
    transition: all 0.2s $easing-in;
}

.select-input-wrapper {
    float: left;
    margin-top: 15px;
    margin-left: 3px;
    margin-right: 10px;
    padding-left: 4px;
    position: relative;
    z-index: 15;
}

.dim {
    opacity: 0.5;
}

</style>
