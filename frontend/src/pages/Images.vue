<template>
    <transition name="slide-fade" appear>
        <div>
            <h1 class="mb-3">{{ $t("dockerImages") }}</h1>

            <!-- Disk Usage Stats -->
            <div v-if="diskUsage" class="shadow-box big-padding mb-4">
                <h4 class="mb-3">{{ $t("diskUsage") }}</h4>
                <div class="row">
                    <div class="col-md-3">
                        <div class="stat-item">
                            <div class="stat-label">{{ $t("images") }}</div>
                            <div class="stat-value">{{ formatSize(diskUsage.Images?.[0]?.Size || 0) }}</div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="stat-item">
                            <div class="stat-label">{{ $t("containers") }}</div>
                            <div class="stat-value">{{ formatSize(diskUsage.Containers?.[0]?.Size || 0) }}</div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="stat-item">
                            <div class="stat-label">{{ $t("volumes") }}</div>
                            <div class="stat-value">{{ formatSize(diskUsage.Volumes?.[0]?.Size || 0) }}</div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="stat-item">
                            <div class="stat-label">{{ $t("buildCache") }}</div>
                            <div class="stat-value">{{ formatSize(diskUsage.BuildCache?.[0]?.Size || 0) }}</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Actions -->
            <div class="mb-3">
                <button class="btn btn-primary me-2" @click="refreshImages">
                    <font-awesome-icon icon="arrows-rotate" class="me-1" />
                    {{ $t("refresh") }}
                </button>
                <button class="btn btn-normal me-2" :disabled="processing" @click="showPullDialog = true">
                    <font-awesome-icon icon="cloud-arrow-down" class="me-1" />
                    {{ $t("pullImage") }}
                </button>
                <button class="btn btn-normal me-2" :disabled="processing" @click="showBuildDialog = true">
                    <font-awesome-icon icon="rocket" class="me-1" />
                    {{ $t("buildImage") }}
                </button>
                <button class="btn btn-normal me-2" :disabled="processing" @click="openUploadDialog">
                    <font-awesome-icon icon="upload" class="me-1" />
                    {{ $t("uploadImage") }}
                </button>
                <button class="btn btn-danger" :disabled="processing" @click="showPruneDialog = true">
                    <font-awesome-icon icon="trash" class="me-1" />
                    {{ $t("pruneImages") }}
                </button>
            </div>

            <!-- Pull Progress -->
            <div v-if="pullProgress" class="shadow-box mb-3 p-3">
                <div class="d-flex align-items-center">
                    <div class="spinner-border spinner-border-sm me-2" role="status">
                        <span class="visually-hidden">{{ $t("loading") }}</span>
                    </div>
                    <span>{{ pullProgress }}</span>
                </div>
            </div>

            <!-- Images List -->
            <div class="shadow-box image-list-container">
                <div class="list-header">
                    <div class="header-top">
                        <div class="placeholder"></div>
                        <div class="search-wrapper">
                            <a v-if="searchText == ''" class="search-icon">
                                <font-awesome-icon icon="search" />
                            </a>
                            <a v-if="searchText != ''" class="search-icon" style="cursor: pointer" @click="clearSearchText">
                                <font-awesome-icon icon="times" />
                            </a>
                            <form>
                                <input v-model="searchText" class="form-control search-input" autocomplete="off" :placeholder="$t('searchImages')" />
                            </form>
                        </div>
                    </div>
                </div>

                <div class="image-list scrollbar">
                    <div v-if="loading" class="text-center p-4">
                        <div class="spinner-border" role="status">
                            <span class="visually-hidden">{{ $t("loading") }}</span>
                        </div>
                    </div>

                    <div v-else-if="filteredImageList.length === 0" class="text-center p-4">
                        <p>{{ $t("noImagesFound") }}</p>
                    </div>

                    <div
                        v-for="image in filteredImageList"
                        v-else
                        :key="image.ID"
                        class="image-item"
                    >
                        <div class="image-info">
                            <div class="image-name">
                                {{ image.Repository }}:<span class="tag">{{ image.Tag }}</span>
                            </div>
                            <div class="image-details">
                                <code class="image-id">{{ image.ID.substring(0, 12) }}</code>
                                <span class="separator">•</span>
                                <span class="created">{{ image.CreatedSince }}</span>
                                <span class="separator">•</span>
                                <span class="size">{{ image.Size }}</span>
                            </div>
                        </div>
                        <div class="image-actions">
                            <button class="btn btn-sm btn-danger" :disabled="processing" @click="confirmDeleteImage(image)">
                                <font-awesome-icon icon="trash" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Delete Confirmation Modal -->
            <BModal v-model="showDeleteDialog" :okTitle="$t('deleteImage')" okVariant="danger" @ok="deleteImage">
                <p v-if="selectedImage">
                    {{ $t("deleteImageMsg") }}
                </p>
                <p v-if="selectedImage" class="fw-bold">
                    {{ selectedImage.Repository }}:{{ selectedImage.Tag }}
                </p>
            </BModal>

            <!-- Pull Image Modal -->
            <BModal v-model="showPullDialog" :okTitle="$t('pullImage')" okVariant="primary" @ok="pullImage">
                <h5>{{ $t("pullImage") }}</h5>
                <div class="mb-3">
                    <label for="imageName" class="form-label">{{ $t("imageName") }}</label>
                    <input id="imageName" v-model="pullImageName" type="text" class="form-control" :placeholder="$t('imageNamePlaceholder')" required>
                    <div class="form-text">{{ $t("imageNameExample") }}</div>
                </div>
            </BModal>

            <!-- Build Image Modal -->
            <BModal v-model="showBuildDialog" :okTitle="$t('buildImage')" okVariant="primary" @ok="buildImage">
                <h5>{{ $t("buildImage") }}</h5>
                <div class="mb-3">
                    <label for="buildImageName" class="form-label">{{ $t("imageName") }}</label>
                    <input id="buildImageName" v-model="buildImageName" type="text" class="form-control" :placeholder="$t('buildImageNamePlaceholder')" required>
                    <div class="form-text">{{ $t("buildImageNameExample") }}</div>
                </div>
                <div class="mb-3">
                    <label for="dockerfile" class="form-label">{{ $t("dockerfile") }}</label>
                    <textarea id="dockerfile" v-model="dockerfileContent" class="form-control dockerfile-textarea" rows="10" :placeholder="$t('dockerfilePlaceholder')" required></textarea>
                    <div class="form-text">{{ $t("dockerfileExample") }}</div>
                </div>
            </BModal>

            <!-- Upload Image Modal -->
            <BModal v-model="showUploadDialog" :title="$t('uploadImage')" hide-footer>
                <p class="form-text">{{ $t("uploadImageHelp") }}</p>
                <div class="mb-3">
                    <label for="imageFile" class="form-label">{{ $t("chooseImageFile") }}</label>
                    <input id="imageFile" type="file" class="form-control" accept=".tar,.tar.gz,.tgz" :disabled="processing" @change="onFileSelected">
                </div>
                <div v-if="processing" class="mb-3">
                    <div class="progress">
                        <div
                            class="progress-bar"
                            role="progressbar"
                            :style="{ width: uploadProgress + '%' }"
                            :aria-valuenow="uploadProgress"
                            aria-valuemin="0"
                            aria-valuemax="100"
                        >
                            {{ uploadProgress }}%
                        </div>
                    </div>
                </div>
                <button class="btn btn-primary" :disabled="!selectedFile || processing" @click="uploadImage">
                    {{ $t("uploadImage") }}
                </button>
            </BModal>

            <!-- Prune Confirmation Modal -->
            <BModal v-model="showPruneDialog" :okTitle="$t('pruneImages')" okVariant="danger" @ok="pruneImages">
                <p><strong class="text-uppercase text-danger">{{ $t("warning") }}</strong></p>
                <p><strong>{{ $t("pruneImagesMsg") }}</strong></p>
                <p>{{ $t("pruneImagesWarning") }}</p>
            </BModal>
        </div>
    </transition>
</template>

<script>
// Kept safely under Socket.IO's default 1 MB per-packet limit
const UPLOAD_CHUNK_SIZE = 512 * 1024;

export default {
    components: {
    },
    data() {
        return {
            imageList: [],
            diskUsage: null,
            loading: true,
            processing: false,
            showDeleteDialog: false,
            showPruneDialog: false,
            showPullDialog: false,
            showBuildDialog: false,
            showUploadDialog: false,
            selectedImage: null,
            pullImageName: "",
            buildImageName: "",
            dockerfileContent: "",
            searchText: "",
            pullProgress: null,
            selectedFile: null,
            uploadProgress: 0,
        };
    },
    computed: {
        endpoint() {
            return this.$route.params.endpoint || "";
        },
        /**
         * Filter images based on search text
         * @returns {Array} Filtered image list
         */
        filteredImageList() {
            if (!this.searchText) {
                return this.imageList;
            }
            const loweredSearchText = this.searchText.toLowerCase();
            return this.imageList.filter(image => {
                return image.Repository.toLowerCase().includes(loweredSearchText) ||
                       image.Tag.toLowerCase().includes(loweredSearchText) ||
                       image.ID.toLowerCase().includes(loweredSearchText);
            });
        }
    },
    mounted() {
        this.loadImages();
        this.loadDiskUsage();
    },
    methods: {
        /**
         * Load the list of Docker images
         */
        loadImages() {
            this.loading = true;
            this.$root.emitAgent(this.endpoint, "getDockerImageList", (res) => {
                if (res.ok) {
                    this.imageList = res.imageList;
                }
                this.loading = false;
            });
        },

        /**
         * Load Docker disk usage statistics
         */
        loadDiskUsage() {
            this.$root.emitAgent(this.endpoint, "getDockerDiskUsage", (res) => {
                if (res.ok) {
                    this.diskUsage = res.diskUsage;
                }
            });
        },

        /**
         * Refresh the images list
         */
        refreshImages() {
            this.loadImages();
            this.loadDiskUsage();
        },

        /**
         * Clear search text
         */
        clearSearchText() {
            this.searchText = "";
        },

        /**
         * Show confirmation dialog for deleting an image
         * @param {object} image - The image to delete
         */
        confirmDeleteImage(image) {
            this.selectedImage = image;
            this.showDeleteDialog = true;
        },

        /**
         * Delete the selected Docker image
         */
        deleteImage() {
            if (!this.selectedImage) {
                return;
            }

            this.processing = true;
            this.$root.emitAgent(this.endpoint, "deleteDockerImage", this.selectedImage.ID, (res) => {
                this.processing = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.loadImages();
                    this.loadDiskUsage();
                }

                this.selectedImage = null;
            });
        },

        /**
         * Pull a Docker image from registry
         */
        pullImage() {
            if (!this.pullImageName || this.pullImageName.trim() === "") {
                return;
            }

            this.processing = true;
            this.pullProgress = this.$t("pullingImage", [ this.pullImageName ]);

            this.$root.emitAgent(this.endpoint, "pullDockerImage", this.pullImageName.trim(), (res) => {
                this.processing = false;
                this.pullProgress = null;

                this.$root.toastRes(res);
                if (res.ok) {
                    this.loadImages();
                    this.loadDiskUsage();
                    this.pullImageName = "";
                }
            });
        },

        /**
         * Build a Docker image from Dockerfile
         */
        buildImage() {
            if (!this.buildImageName || this.buildImageName.trim() === "" || !this.dockerfileContent || this.dockerfileContent.trim() === "") {
                return;
            }

            this.processing = true;
            this.pullProgress = this.$t("buildingImage", [ this.buildImageName ]);

            this.$root.emitAgent(this.endpoint, "buildDockerImage", this.buildImageName.trim(), this.dockerfileContent, (res) => {
                this.processing = false;
                this.pullProgress = null;

                this.$root.toastRes(res);
                if (res.ok) {
                    this.loadImages();
                    this.loadDiskUsage();
                    this.buildImageName = "";
                    this.dockerfileContent = "";
                }
            });
        },

        /**
         * Reset upload state and show the upload dialog
         */
        openUploadDialog() {
            this.selectedFile = null;
            this.uploadProgress = 0;
            this.showUploadDialog = true;
        },

        /**
         * Track the file chosen in the upload dialog's file input
         * @param {Event} e - The file input change event
         */
        onFileSelected(e) {
            this.selectedFile = e.target.files[0] || null;
        },

        /**
         * Promise wrapper around emitAgent, for use with async/await
         * @param {string} event - Agent socket event name
         * @param {...*} args - Arguments to pass to the event
         * @returns {Promise<object>} The response from the server
         */
        emitAgentAsync(event, ...args) {
            return new Promise((resolve) => {
                this.$root.emitAgent(this.endpoint, event, ...args, resolve);
            });
        },

        /**
         * Upload the selected file in chunks and load it as a Docker image
         */
        async uploadImage() {
            const file = this.selectedFile;
            if (!file) {
                return;
            }

            this.processing = true;
            this.uploadProgress = 0;

            const startRes = await this.emitAgentAsync("startImageUpload", file.name, file.size);
            if (!startRes.ok) {
                this.processing = false;
                this.$root.toastRes(startRes);
                return;
            }

            const uploadId = startRes.uploadId;
            const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_SIZE) || 1;

            for (let index = 0; index < totalChunks; index++) {
                const start = index * UPLOAD_CHUNK_SIZE;
                const end = Math.min(start + UPLOAD_CHUNK_SIZE, file.size);
                const buf = await file.slice(start, end).arrayBuffer();

                const chunkRes = await this.emitAgentAsync("uploadImageChunk", uploadId, index, buf);
                if (!chunkRes.ok) {
                    this.emitAgentAsync("cancelImageUpload", uploadId);
                    this.processing = false;
                    this.$root.toastRes(chunkRes);
                    return;
                }

                this.uploadProgress = Math.round(((index + 1) / totalChunks) * 100);
            }

            this.pullProgress = this.$t("loadingImage");
            const finishRes = await this.emitAgentAsync("finishImageUpload", uploadId);
            this.pullProgress = null;
            this.processing = false;

            this.$root.toastRes(finishRes);
            if (finishRes.ok) {
                this.loadImages();
                this.loadDiskUsage();
                this.selectedFile = null;
                this.showUploadDialog = false;
            }
        },

        /**
         * Prune unused Docker images
         */
        pruneImages() {
            this.processing = true;
            this.$root.emitAgent(this.endpoint, "pruneDockerImages", (res) => {
                this.processing = false;
                this.$root.toastRes(res);
                if (res.ok) {
                    this.loadImages();
                    this.loadDiskUsage();
                }
            });
        },

        /**
         * Format size in bytes to human readable format
         * @param {number} bytes - Size in bytes
         * @returns {string} Formatted size string
         */
        formatSize(bytes) {
            if (!bytes) {
                return "0 B";
            }

            const sizes = [ "B", "KB", "MB", "GB", "TB" ];
            const i = Math.floor(Math.log(bytes) / Math.log(1024));
            return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + " " + sizes[i];
        }
    }
};
</script>

<style scoped lang="scss">
@import "../styles/vars.scss";

.stat-item {
    text-align: center;
    padding: 1rem;
}

.stat-label {
    font-size: 0.875rem;
    color: #6c757d;
    margin-bottom: 0.5rem;

    .dark & {
        color: $dark-font-color;
    }
}

.stat-value {
    font-size: 1.5rem;
    font-weight: bold;
}

.shadow-box {
    padding: 20px;
}

.image-list-container {
    height: calc(100vh - 500px);
    min-height: 400px;
}

.list-header {
    border-bottom: 1px solid #dee2e6;
    border-radius: 10px 10px 0 0;
    margin: -10px;
    margin-bottom: 10px;
    padding: 10px;

    .dark & {
        background-color: $dark-header-bg;
        border-bottom: 0;
    }
}

.header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.search-wrapper {
    display: flex;
    align-items: center;
}

.search-icon {
    padding: 10px;
    color: #c0c0c0;

    svg[data-icon="times"] {
        cursor: pointer;
        transition: all ease-in-out 0.1s;

        &:hover {
            opacity: 0.5;
        }
    }
}

.search-input {
    max-width: 15em;
}

.image-list {
    height: calc(100% - 60px);
    overflow-y: auto;
}

.image-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 15px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    transition: all ease-in-out 0.2s;

    &:hover {
        background-color: rgba(255, 255, 255, 0.05);

        .dark & {
            background-color: $dark-bg2;
        }
    }

    .dark & {
        border-bottom-color: $dark-border-color;
    }
}

.image-info {
    flex: 1;
}

.image-name {
    font-weight: 600;
    font-size: 1rem;
    margin-bottom: 4px;

    .tag {
        color: $primary;
    }
}

.image-details {
    font-size: 0.875rem;
    color: #6c757d;
    display: flex;
    align-items: center;
    gap: 8px;

    .dark & {
        color: $dark-font-color;
    }
}

.image-id {
    font-size: 0.75rem;
    background-color: rgba(0, 0, 0, 0.1);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: monospace;

    .dark & {
        background-color: $dark-bg2;
        color: $dark-font-color;
    }
}

.separator {
    color: #dee2e6;

    .dark & {
        color: $dark-border-color;
    }
}

.image-actions {
    display: flex;
    gap: 8px;
}

.dockerfile-textarea {
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    background-color: $dark-bg !important;
    color: $dark-font-color !important;
    border: 1px solid $dark-border-color;

    &::placeholder {
        color: #6c757d;
    }
}
</style>
