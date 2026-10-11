#!/usr/bin/env node

/**
 * MeTiger-Ai Release Preparation Script
 * Groups multiple commits into a single release with +0.001 version bump
 * 
 * Usage:
 *   npm run prepare-release
 *   npm run release
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const configPath = path.join(__dirname, '..', '.release-config.json');
const config = require(configPath);

const repoRoot = path.join(__dirname, '..');
const versionFile = path.join(repoRoot, 'VERSION.md');
const changelogFile = path.join(repoRoot, config.changelogFile || 'CHANGELOG.md');

function getCurrentVersion() {
    try {
        const versionContent = fs.readFileSync(versionFile, 'utf8');
        const content = versionContent.trim();
        
        // Extract version number from formats like "0.169" or "# Version 0.169"
        // Version format is 0.XXX where XXX is 1-3 digits
        const match = content.match(/(\d+\.\d{1,3})/);
        if (match) {
            return match[1];
        }
        
        // If no match, try to use as-is
        if (/^\d+\.\d{1,3}$/.test(content)) {
            return content;
        }
        
        console.error('Error: VERSION.md does not contain a valid version number');
        console.error(`Content: ${content}`);
        process.exit(1);
    } catch (error) {
        console.error('Error reading VERSION.md:', error.message);
        process.exit(1);
    }
}

function incrementVersion(currentVersion) {
    const parts = currentVersion.split('.').map(Number);
    
    // Handle format like 0.169 (2 parts) - increment the second part
    if (parts.length === 2) {
        parts[1] += 1; // Increment by 0.001 means incrementing the decimal part
        return parts.join('.');
    }
    
    // Handle format like 0.1.69 (3 parts) - increment the third part
    if (parts.length === 3) {
        parts[2] += 1;
        return parts.join('.');
    }
    
    // Fallback: try to parse as float and add 0.001
    const versionNum = parseFloat(currentVersion);
    const newVersion = (versionNum + 0.001).toFixed(3);
    return newVersion;
}

function getCommitsSinceLastRelease() {
    try {
        // Get the last release tag or use initial commit
        let lastTag;
        try {
            lastTag = execSync('git describe --tags --abbrev=0 2>/dev/null', { cwd: repoRoot }).toString().trim();
        } catch (e) {
            // No tags found, use initial commit
            lastTag = execSync('git rev-list --max-parents=0 HEAD', { cwd: repoRoot }).toString().trim();
        }
        
        // Get commits since last tag
        const commits = execSync(
            `git log ${lastTag}..HEAD --pretty=format:"%h - %s (%an)" --reverse`,
            { cwd: repoRoot, encoding: 'utf8' }
        ).trim();
        
        return commits ? commits.split('\n') : [];
    } catch (error) {
        console.error('Error getting commits:', error.message);
        return [];
    }
}

function generateReleaseNotes(commits, newVersion) {
    if (commits.length === 0) {
        return `## ${newVersion}

No new commits since last release.
`;
    }
    
    const date = new Date().toISOString().split('T')[0];
    const notes = [`## ${newVersion} (${date})`, '', '### Changes'];
    
    commits.forEach(commit => {
        notes.push(`- ${commit}`);
    });
    
    notes.push('', '');
    return notes.join('\n');
}

function updateChangelog(newVersion, releaseNotes) {
    let changelogContent = '';
    
    try {
        changelogContent = fs.readFileSync(changelogFile, 'utf8');
    } catch (error) {
        // Changelog doesn't exist yet, start fresh
        changelogContent = '# Changelog\n\n';
    }
    
    // Insert new release notes at the top
    const updatedChangelog = changelogContent.startsWith('# Changelog')
        ? changelogContent.replace('# Changelog\n', `# Changelog\n\n${releaseNotes}`)
        : `${changelogContent}\n\n${releaseNotes}`;
    
    fs.writeFileSync(changelogFile, updatedChangelog, 'utf8');
}

function updateVersionFile(newVersion) {
    fs.writeFileSync(versionFile, newVersion, 'utf8');
}

function updatePackageJson(newVersion) {
    const packageJsonPath = path.join(repoRoot, 'package.json');
    const packageJson = require(packageJsonPath);
    packageJson.version = newVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
}

function main() {
    console.log('Preparing release...\n');
    
    // Get current version
    const currentVersion = getCurrentVersion();
    console.log(`Current version: ${currentVersion}`);
    
    // Get commits since last release
    const commits = getCommitsSinceLastRelease();
    console.log(`\nCommits since last release (${commits.length}):`);
    commits.forEach(c => console.log(`  ${c}`));
    
    if (commits.length === 0) {
        console.log('\nNo new commits. Nothing to release.');
        process.exit(0);
    }
    
    // Calculate new version
    const newVersion = incrementVersion(currentVersion);
    console.log(`\nNew version: ${newVersion}`);
    
    // Generate release notes
    const releaseNotes = generateReleaseNotes(commits, newVersion);
    console.log('\nGenerated release notes:');
    console.log(releaseNotes);
    
    // Update files
    updateVersionFile(newVersion);
    updatePackageJson(newVersion);
    updateChangelog(newVersion, releaseNotes);
    
    console.log('\nFiles updated:');
    console.log(`  VERSION.md -> ${newVersion}`);
    console.log(`  package.json -> ${newVersion}`);
    console.log(`  ${config.changelogFile || 'CHANGELOG.md'} -> Updated`);
    
    console.log('\n✅ Release preparation complete!');
    console.log('Run "npm run release" to commit and tag the release.');
}

main();
